// People, memberships and the generation counter, read from the upstream
// buckets and cached in memory.
//
// Two proxies may front the same storage, so the cache is not authoritative:
// every write is guarded with If-Match or If-None-Match, and a poll of
// `generation.json` every 5 s picks up what the other one did. A write reloads
// its own process immediately, which is what "takes effect at once on the
// proxy that made it" means.

import { makeNamespace } from './namespace.mjs';

export const GENERATION_KEY = 'Settings/access/generation.json';
export const PEOPLE_PREFIX = 'Settings/access/people/';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isSettingsBucket = (client) =>
  client === 'sparcd' || client.startsWith('sparcd-settings');

export const collectionUuid = (client) => {
  const rest = client.startsWith('sparcd-') ? client.slice(7) : null;
  return rest && UUID.test(rest) ? rest : null;
};

export class Conflict extends Error {
  constructor(message) { super(message); this.name = 'Conflict'; }
}

export function makeStore({
  upstream, namespace = '', allow, pollMs = 5000, fullReloadMs = 60000,
}) {
  const ns = makeNamespace({ namespace, allow });
  let state = emptyState();
  let timer = null;
  let lastFullReload = 0;

  function emptyState() {
    return {
      generation: 0,
      settingsBucket: null,
      people: new Map(),
      byAccessKey: new Map(),
      collections: new Map(),
    };
  }

  const settings = () => {
    if (!state.settingsBucket) throw new Error('no settings bucket in the namespace');
    return ns.toUpstream(state.settingsBucket);
  };

  // One reload at a time, and at most one follow-up queued behind it. Two
  // overlapping reloads can finish out of order, and the slower one then
  // overwrites newer state with older — a pause that reappears as active.
  let running = null;
  let queued = null;

  function reload() {
    if (!running) return runReload();
    if (!queued) queued = running.then(runReload, runReload);
    return queued;
  }

  function runReload() {
    queued = null;
    running = doReload().finally(() => { running = null; });
    return running;
  }

  async function doReload() {
    const next = emptyState();
    for (const upstreamName of await upstream.listBuckets()) {
      const client = ns.toClient(upstreamName);
      if (client === null) continue;
      if (isSettingsBucket(client)) { next.settingsBucket = client; continue; }
      const uuid = collectionUuid(client);
      if (uuid) next.collections.set(client, { bucket: client, uuid, members: [], membersEtag: null });
    }
    if (!next.settingsBucket) { state = next; return state; }

    // A reload is the slowest thing the proxy does, and every write waits on
    // one. Against storage that answers in 150 ms, reading the people one after
    // another put "add a person" — two writes, each followed by a reload — past
    // fifteen seconds on its own. Depth is what costs, so the round trips that
    // do not depend on each other are made together.
    const sb = ns.toUpstream(next.settingsBucket);
    const [gen, peopleKeys] = await Promise.all([
      upstream.getJson(sb, GENERATION_KEY),
      upstream.listKeys(sb, PEOPLE_PREFIX),
    ]);
    next.generation = gen.status === 404 ? 0 : (gen.value.generation ?? 0);
    next.generationEtag = gen.status === 404 ? null : gen.etag;

    // Applied in the order the listing gave, so two people sharing an access
    // key id resolve the same way on every reload.
    const read = await Promise.all(peopleKeys
      .filter((key) => key.endsWith('.json'))
      .map((key) => upstream.getJson(sb, key)));
    for (const got of read) {
      if (got.status === 404) continue;
      const person = { ...got.value, etag: got.etag };
      next.people.set(person.id, person);
      for (const k of person.keys ?? []) {
        if (!k.retiredAt) next.byAccessKey.set(k.accessKeyId, { personId: person.id, key: k });
      }
    }

    await Promise.all([...next.collections.values()].map(async (c) => {
      const u = ns.toUpstream(c.bucket);
      const [members, meta] = await Promise.all([
        upstream.getJson(u, `Collections/${c.uuid}/members.json`),
        upstream.getJson(u, `Collections/${c.uuid}/collection.json`).catch(() => ({ status: 404 })),
      ]);
      if (members.status !== 404) {
        c.members = members.value.members ?? [];
        c.membersEtag = members.etag;
      }
      if (meta.status !== 404) {
        // `collection.json` carries the SPARC'd `*Property` names; `name` and
        // `organization` are the short spellings some fixtures use.
        c.name = meta.value.nameProperty ?? meta.value.name ?? c.bucket;
        c.organization = meta.value.organizationProperty ?? meta.value.organization ?? null;
      } else {
        c.name = c.bucket;
      }
    }));

    state = next;
    lastFullReload = Date.now();
    return state;
  }

  // The generation counter is the fast path, not the only one. A bump that was
  // lost — because the proxy that made the change could not write the counter —
  // would otherwise never reach the other proxies at all.
  async function poll() {
    if (Date.now() - lastFullReload >= fullReloadMs) {
      await reload();
      return;
    }
    const gen = await upstream.getJson(settings(), GENERATION_KEY);
    const seen = gen.status === 404 ? 0 : (gen.value.generation ?? 0);
    if (seen !== state.generation) await reload();
  }

  async function bumpGeneration() {
    const current = await upstream.getJson(settings(), GENERATION_KEY);
    const next = (current.status === 404 ? 0 : current.value.generation ?? 0) + 1;
    const guard = current.status === 404 ? { ifNoneMatch: '*' } : { ifMatch: current.etag };
    const ok = await upstream.put(
      settings(), GENERATION_KEY, JSON.stringify({ generation: next }), guard,
    );
    // Another proxy bumped it first; its value is as good as ours, and the
    // reload below picks up both writes.
    if (!ok) return;
  }

  return {
    ns,
    reload,
    snapshot: () => state,
    settingsBucketUpstream: settings,

    start() {
      if (!timer) {
        timer = setInterval(() => { poll().catch(() => {}); }, pollMs);
        timer.unref?.();
      }
    },
    stop() { if (timer) { clearInterval(timer); timer = null; } },

    person: (id) => state.people.get(id) ?? null,
    people: () => [...state.people.values()],
    byAccessKey: (accessKeyId) => {
      const hit = state.byAccessKey.get(accessKeyId);
      return hit ? { person: state.people.get(hit.personId), key: hit.key } : null;
    },
    collection: (bucket) => state.collections.get(bucket) ?? null,
    collections: () => [...state.collections.values()],
    membership(personId, bucket) {
      const c = state.collections.get(bucket);
      return c?.members.find((m) => m.personId === personId) ?? null;
    },
    isSettings: (bucket) => bucket === state.settingsBucket,

    /** @param expect `'new'` for a create, or the etag the caller read. */
    async savePerson(person, expect) {
      const body = JSON.stringify({ ...person, etag: undefined, updatedAt: new Date().toISOString() });
      const guard = expect === 'new' ? { ifNoneMatch: '*' } : { ifMatch: expect };
      const ok = await upstream.put(
        settings(), `${PEOPLE_PREFIX}${person.id}.json`, body, guard,
      );
      if (!ok) throw new Conflict('person changed underneath this edit');
      // The write landed, so this process must see it whatever happens next.
      // Skipping the reload because the counter bump threw would leave a pause
      // or a key retirement written but not in force here.
      try {
        await bumpGeneration();
      } finally {
        await reload();
      }
      return state.people.get(person.id);
    },

    async saveMembers(bucket, members, expect) {
      const c = state.collections.get(bucket);
      if (!c) throw new Error(`unknown collection bucket ${bucket}`);
      const body = JSON.stringify({ schemaVersion: 1, members });
      const guard = expect === null ? { ifNoneMatch: '*' } : { ifMatch: expect };
      const ok = await upstream.put(
        ns.toUpstream(bucket), `Collections/${c.uuid}/members.json`, body, guard,
      );
      if (!ok) throw new Conflict('members changed underneath this edit');
      try {
        await bumpGeneration();
      } finally {
        await reload();
      }
      return state.collections.get(bucket);
    },
  };
}
