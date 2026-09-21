// The activity log: append-only NDJSON, one immutable object per flush.
//
// Batched because the alternative is a PUT per download. A flush object is
// written with If-None-Match: * and never touched again, so two proxies
// writing the same day never contend — the epoch-plus-random name makes a
// collision a retry, not a lost line.
//
// A flush that fails puts its lines back rather than dropping them, so a brief
// upstream outage costs latency and not history. That queue is bounded: past
// the cap the oldest go and a `log-gap` line says how many, because a log that
// silently skips is worse than one that admits a hole.

const ACTIVITY_PREFIX = 'Settings/activity/';
const FLUSH_LINES = 200;
const FLUSH_MS = 5000;
const MAX_QUEUE = 10000;
const READ_CONCURRENCY = 8;
const BAD_SIGNATURE_WINDOW_MS = 60000;

const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

export function makeActivity({
  upstream, settingsBucket, flushMs = FLUSH_MS, maxQueue = MAX_QUEUE,
}) {
  let buffer = [];
  let timer = null;
  // The single in-flight flush. Every trigger chains onto it rather than
  // starting its own: concurrent flushes each take the whole backlog, so the
  // queue cap stops counting what is in flight and the same lines get written
  // twice on a retry.
  let flushing = Promise.resolve();
  let dropped = 0;
  const seenToday = new Set();
  const badSignatures = new Map();

  function enqueue(line) {
    buffer.push(line);
    if (buffer.length > maxQueue) {
      dropped += buffer.length - maxQueue;
      buffer = buffer.slice(-maxQueue);
    }
  }

  function kick() {
    flushing = flushing.then(flushOnce, flushOnce);
    return flushing;
  }

  async function flushOnce() {
    if (dropped > 0) {
      const count = dropped;
      dropped = 0;
      enqueue({
        ts: new Date().toISOString(), kind: 'log-gap', status: 0,
        detail: { dropped: count },
      });
    }
    if (buffer.length === 0) return;
    const batch = buffer;
    buffer = [];

    // One object per day touched, so a flush that straddles midnight still
    // lands each line in the day it happened.
    const byDay = new Map();
    for (const e of batch) {
      const day = dayOf(e.ts);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(e);
    }
    const failed = [];
    for (const [day, lines] of byDay) {
      const body = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
      let written = false;
      try {
        // No transport retries: the re-queue below is the retry, and it is the
        // one that respects the cap and the flush interval.
        written = await upstream().put(settingsBucket(), nameFor(day), body, {
          contentType: 'application/x-ndjson', ifNoneMatch: '*', retry: false,
        });
      } catch {
        written = false;
      }
      if (!written) failed.push(...lines);
    }
    // Back in front of anything recorded while the flush ran, so order holds.
    if (failed.length > 0) {
      buffer = [...failed, ...buffer];
      if (buffer.length > maxQueue) {
        dropped += buffer.length - maxQueue;
        buffer = buffer.slice(-maxQueue);
      }
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      kick().catch(() => {});
    }, flushMs);
    timer.unref?.();
  }

  return {
    /** @param event the contract shape, minus `ts` which is stamped here. */
    record(event) {
      enqueue({ ts: new Date().toISOString(), ...event });
      if (buffer.length >= FLUSH_LINES) {
        kick().catch(() => {});
      } else {
        schedule();
      }
    },

    /**
     * One line per source per minute. A signature failure is cheap to produce
     * and an attacker controls the rate, so the log records that it happened
     * and how often rather than one line per attempt.
     */
    badSignature(source, event) {
      const now = Date.now();
      this.sweep(now);
      const open = badSignatures.get(source);
      if (open && now - open.since < BAD_SIGNATURE_WINDOW_MS) {
        open.count += 1;
        open.line.detail.count = open.count;
        return;
      }
      const line = {
        ts: new Date(now).toISOString(),
        requestId: event.requestId ?? null,
        personId: null,
        personName: null,
        kind: 'bad-signature',
        bucket: event.bucket ?? null,
        status: 403,
        ip: source,
        detail: { reason: event.detail, count: 1 },
      };
      badSignatures.set(source, { since: now, count: 1, line });
      enqueue(line);
      schedule();
    },

    /** Sources that have gone quiet stop costing a map entry. */
    sweep(now = Date.now()) {
      for (const [source, open] of badSignatures) {
        if (now - open.since >= BAD_SIGNATURE_WINDOW_MS) badSignatures.delete(source);
      }
    },

    trackedSources: () => badSignatures.size,

    /** The contract's `sign-in`: first request per key per day. */
    signIn(accessKeyId, event) {
      const stamp = `${accessKeyId}:${dayOf(Date.now())}`;
      if (seenToday.has(stamp)) return;
      seenToday.add(stamp);
      this.record({ ...event, kind: 'sign-in' });
    },

    async drain() {
      if (timer) { clearTimeout(timer); timer = null; }
      badSignatures.clear();
      await flushing.catch(() => {});
      await kick().catch(() => {});
    },

    async query({ from, to, person, bucket, kind, limit = 200 } = {}) {
      const events = await read({ upstream, settingsBucket, from, to });
      const matched = events.filter((e) =>
        (!person || e.personId === person)
        && (!bucket || e.bucket === bucket)
        && (!kind || e.kind === kind)
        && (!from || e.ts >= from)
        && (!to || e.ts <= to));
      matched.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
      return { events: matched.slice(0, limit), truncated: matched.length > limit };
    },

    async downloads({ bucket, key, from, to }) {
      const { events } = await this.query({ kind: 'download', bucket, from, to, limit: Infinity });
      return { events: key ? events.filter((e) => e.key === key) : events };
    },
  };
}

function nameFor(day) {
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${ACTIVITY_PREFIX}${day}/${Date.now()}-${rand}.ndjson`;
}

/**
 * Read the day objects in range. Listing is done per day prefix rather than
 * across the whole tree, and the reads run eight at a time, so one query can
 * neither list a year of objects in one call nor open a thousand sockets.
 */
async function read({ upstream, settingsBucket, from, to }) {
  const client = upstream();
  const bucket = settingsBucket();
  const fromDay = from ? dayOf(Date.parse(from)) : null;
  const toDay = to ? dayOf(Date.parse(to)) : null;

  const days = fromDay
    ? daysBetween(fromDay, toDay ?? dayOf(Date.now()))
    : (await client.listCommonPrefixes(bucket, ACTIVITY_PREFIX))
      .map((p) => p.slice(ACTIVITY_PREFIX.length).replace(/\/$/, ''))
      .filter((day) => (!toDay || day <= toDay));

  const keys = (await mapLimit(days, READ_CONCURRENCY,
    (day) => client.listKeys(bucket, `${ACTIVITY_PREFIX}${day}/`))).flat();

  const bodies = await mapLimit(keys, READ_CONCURRENCY, (k) => client.get(bucket, k));
  const out = [];
  for (const got of bodies) {
    if (got.status === 404) continue;
    for (const line of got.text.split('\n')) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }
  return out;
}

function daysBetween(fromDay, toDay) {
  const days = [];
  for (let t = Date.parse(fromDay); t <= Date.parse(toDay); t += 86400000) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]);
  });
  await Promise.all(workers);
  return out;
}
