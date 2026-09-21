// The activity log: append-only NDJSON, one immutable object per flush.
//
// Batched because the alternative is a PUT per download. A flush object is
// written with If-None-Match: * and never touched again, so two proxies
// writing the same day never contend — the epoch-plus-random name makes a
// collision a retry, not a lost line.

const ACTIVITY_PREFIX = 'Settings/activity/';
const FLUSH_LINES = 200;
const FLUSH_MS = 5000;

const dayOf = (ts) => new Date(ts).toISOString().slice(0, 10);

export function makeActivity({ upstream, settingsBucket, flushMs = FLUSH_MS }) {
  let buffer = [];
  let timer = null;
  let flushing = null;
  const seenToday = new Set();

  async function flush() {
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
    for (const [day, lines] of byDay) {
      const body = `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
      let key = nameFor(day);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const ok = await upstream().put(settingsBucket(), key, body, {
          contentType: 'application/x-ndjson', ifNoneMatch: '*',
        });
        if (ok) break;
        key = nameFor(day);
      }
    }
  }

  function schedule() {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      flushing = flush().catch(() => {});
    }, flushMs);
    timer.unref?.();
  }

  return {
    /** @param event the contract shape, minus `ts` which is stamped here. */
    record(event) {
      buffer.push({ ts: new Date().toISOString(), ...event });
      if (buffer.length >= FLUSH_LINES) {
        flushing = flush().catch(() => {});
      } else {
        schedule();
      }
    },

    /** The contract's `sign-in`: first request per key per day. */
    signIn(accessKeyId, event) {
      const stamp = `${accessKeyId}:${dayOf(Date.now())}`;
      if (seenToday.has(stamp)) return;
      seenToday.add(stamp);
      this.record({ ...event, kind: 'sign-in' });
    },

    async drain() {
      if (timer) { clearTimeout(timer); timer = null; }
      await flushing;
      await flush();
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

    async downloads({ bucket, key }) {
      const { events } = await this.query({ kind: 'download', bucket, limit: Infinity });
      return { events: key ? events.filter((e) => e.key === key) : events };
    },
  };
}

function nameFor(day) {
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return `${ACTIVITY_PREFIX}${day}/${Date.now()}-${rand}.ndjson`;
}

async function read({ upstream, settingsBucket, from, to }) {
  const fromDay = from ? dayOf(Date.parse(from)) : null;
  const toDay = to ? dayOf(Date.parse(to)) : null;
  const keys = await upstream().listKeys(settingsBucket(), ACTIVITY_PREFIX);
  const wanted = keys.filter((k) => {
    const day = k.slice(ACTIVITY_PREFIX.length, ACTIVITY_PREFIX.length + 10);
    return (!fromDay || day >= fromDay) && (!toDay || day <= toDay);
  });
  const out = [];
  await Promise.all(wanted.map(async (k) => {
    const got = await upstream().get(settingsBucket(), k);
    if (got.status === 404) return;
    for (const line of got.text.split('\n')) {
      if (line.trim()) out.push(JSON.parse(line));
    }
  }));
  return out;
}
