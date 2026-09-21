// The `/-/` JSON API: who you are, who everyone is, and who may do what.
//
// It shares the S3 origin and the S3 signature check — a caller signs an API
// call with the same key pair it signs a GetObject with — so the admin app
// needs one credential and no second login. `/-/join` and `/-/health` are the
// exceptions, since a joining person has no key yet.

import { KINDS } from './activity.mjs';
import { Conflict } from './store.mjs';
import {
  INVITE_TTL_MS, inviteMatches, newAccessKeyId, newInvite, newPersonId,
  newSecretKey, wrapSecret,
} from './keys.mjs';

/** The closed set the contract publishes. `error.code` is never anything else. */
export const ERROR_CODES = new Set([
  'invalid', 'forbidden', 'not_found', 'last_admin', 'last_runner',
  'changed_elsewhere', 'too_large', 'busy', 'upstream',
]);

const STATUS_FOR = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  last_admin: 409,
  last_runner: 409,
  changed_elsewhere: 412,
  too_large: 413,
  busy: 503,
  upstream: 502,
};

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = STATUS_FOR[code];
  }
}

const fail = (code, message) => { throw new ApiError(code, message); };

/** `kind=denied,bad-signature` — the admin screens filter on several at once. */
function parseKinds(raw) {
  if (!raw) return undefined;
  const kinds = raw.split(',').map((k) => k.trim()).filter(Boolean);
  for (const kind of kinds) {
    if (!KINDS.has(kind)) fail('invalid', `unknown activity kind ${kind}`);
  }
  return kinds.length ? kinds : undefined;
}

const ACCESS_LEVELS = ['look', 'identify', 'upload', 'run'];

const publicPerson = (p) => ({
  id: p.id, name: p.name, email: p.email, status: p.status, admin: !!p.admin,
});

const membership = (m) => (m ? { access: m.access, exactLocations: !!m.exactLocations } : undefined);

export function makeApi({ store, activity, masterKey, publicEndpoint, lastActive }) {
  const collectionsFor = (personId) =>
    store.collections()
      .map((c) => ({ c, m: c.members.find((m) => m.personId === personId) }))
      .filter(({ m }) => m)
      .map(({ c, m }) => ({
        bucket: c.bucket, uuid: c.uuid, name: c.name,
        access: m.access, exactLocations: !!m.exactLocations,
      }));

  const activeAdmins = () => store.people().filter((p) => p.admin && p.status === 'active');

  /**
   * One line per change, naming the change and its target. The admin screen
   * reads these directly, so "what happened" is a word and not a diff to
   * interpret.
   */
  function logChange(actor, requestId, change, target, extra = {}) {
    activity.record({
      requestId,
      personId: actor?.id ?? null,
      personName: actor?.name ?? null,
      kind: 'access-change',
      bucket: extra.bucket ?? null,
      status: 200,
      detail: {
        change,
        target: { personId: target.id, personName: target.name },
        ...(extra.bucket ? { bucket: extra.bucket, collectionName: extra.collectionName ?? null } : {}),
        ...(extra.before ? { before: extra.before } : {}),
        ...(extra.after ? { after: extra.after } : {}),
      },
    });
  }

  async function handle({ method, path, query, headers, body, person, requestId }) {
    const json = () => {
      if (!body?.length) return {};
      try {
        return JSON.parse(Buffer.from(body).toString('utf8'));
      } catch {
        return fail('invalid', 'body is not JSON');
      }
    };

    if (path === '/-/health' && method === 'GET') return { status: 200, body: { ok: true } };
    if (path === '/-/join' && method === 'POST') {
      return { status: 200, body: await join(json().token, requestId) };
    }

    if (!person) fail('forbidden', 'signature required');
    if (person.status !== 'active') fail('forbidden', `person is ${person.status}`);

    if (path === '/-/whoami' && method === 'GET') {
      return {
        status: 200,
        body: { ...publicPerson(person), collections: collectionsFor(person.id) },
      };
    }

    const oneMember = /^\/-\/admin\/collections\/([^/]+)\/members\/([^/]+)$/.exec(path);
    if (oneMember) {
      const bucket = decodeURIComponent(oneMember[1]);
      const personId = decodeURIComponent(oneMember[2]);
      if (method === 'PUT') {
        return { status: 200, body: await setOneMember(person, bucket, personId, json(), requestId) };
      }
      if (method === 'DELETE') {
        return { status: 200, body: await removeOneMember(person, bucket, personId, requestId) };
      }
      fail('not_found', 'no such endpoint');
    }

    const allMembers = /^\/-\/admin\/collections\/([^/]+)\/members$/.exec(path);
    if (allMembers && method === 'PUT') {
      return {
        status: 200,
        body: await putMembers(person, decodeURIComponent(allMembers[1]), json(), headers, requestId),
      };
    }

    if (path === '/-/admin/people' && method === 'GET') {
      requireAdmin(person);
      return {
        status: 200,
        body: {
          people: store.people().map((p) => ({
            ...publicPerson(p),
            lastActiveAt: lastActive.get(p.id) ?? null,
            collections: collectionsFor(p.id),
          })),
        },
      };
    }

    if (path === '/-/admin/people' && method === 'POST') {
      requireAdmin(person);
      return { status: 200, body: await createPerson(person, json(), requestId) };
    }

    const onePerson = /^\/-\/admin\/people\/([^/]+)$/.exec(path);
    if (onePerson && method === 'PATCH') {
      requireAdmin(person);
      return {
        status: 200,
        body: await patchPerson(person, decodeURIComponent(onePerson[1]), json(), requestId),
      };
    }

    const reset = /^\/-\/admin\/people\/([^/]+)\/reset$/.exec(path);
    if (reset && method === 'POST') {
      requireAdmin(person);
      return { status: 200, body: await resetPerson(person, decodeURIComponent(reset[1]), requestId) };
    }

    if (path === '/-/admin/collections' && method === 'GET') {
      requireAdmin(person);
      return {
        status: 200,
        body: {
          collections: store.collections().map((c) => ({
            bucket: c.bucket,
            uuid: c.uuid,
            name: c.name,
            organization: c.organization ?? null,
            membersVersion: c.membersEtag ?? null,
            members: c.members.map((m) => ({ ...m, name: store.person(m.personId)?.name ?? null })),
          })),
        },
      };
    }

    if (path === '/-/admin/activity' && method === 'GET') {
      requireAdmin(person);
      await activity.drain();
      return {
        status: 200,
        body: await activity.query({
          from: query.get('from') ?? undefined,
          to: query.get('to') ?? undefined,
          person: query.get('person') ?? undefined,
          bucket: query.get('bucket') ?? undefined,
          kinds: parseKinds(query.get('kind')),
          limit: query.get('limit') ? Number(query.get('limit')) : 200,
        }),
      };
    }

    if (path === '/-/admin/activity/downloads' && method === 'GET') {
      requireAdmin(person);
      await activity.drain();
      return {
        status: 200,
        body: await activity.downloads({
          bucket: query.get('bucket') ?? undefined,
          key: query.get('key') ?? undefined,
          from: query.get('from') ?? undefined,
          to: query.get('to') ?? undefined,
        }),
      };
    }

    return fail('not_found', 'no such endpoint');
  }

  function requireAdmin(person) {
    if (!person?.admin) fail('forbidden', 'admin only');
  }

  async function join(token, requestId) {
    if (!token) fail('not_found', 'no such invite');
    const person = store.people().find((p) => inviteMatches(p.invite, token));
    // One 404 for unknown, used and expired alike: distinguishing them tells a
    // guesser which tokens once existed.
    if (!person || person.status !== 'invited') fail('not_found', 'no such invite');

    const secretKey = newSecretKey();
    const accessKey = newAccessKeyId();
    await store.savePerson({
      ...person,
      status: 'active',
      invite: undefined,
      keys: [
        ...(person.keys ?? []),
        {
          accessKeyId: accessKey,
          wrappedSecret: await wrapSecret(masterKey, secretKey),
          createdAt: new Date().toISOString(),
        },
      ],
    }, person.etag);
    logChange(person, requestId, 'joined', person);
    return { endpoint: publicEndpoint, accessKey, secretKey, name: person.name };
  }

  async function createPerson(actor, input, requestId) {
    if (!input.name || !input.email) fail('invalid', 'name and email are required');
    if (input.admin !== undefined && typeof input.admin !== 'boolean') {
      fail('invalid', 'admin must be a boolean');
    }
    const { token, record } = newInvite();
    const now = new Date().toISOString();
    const person = {
      schemaVersion: 1,
      id: newPersonId(),
      name: input.name,
      email: input.email,
      status: 'invited',
      admin: !!input.admin,
      keys: [],
      invite: record,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    const saved = await store.savePerson(person, 'new');
    logChange(actor, requestId, 'invited', saved);
    if (saved.admin) logChange(actor, requestId, 'admin-granted', saved);
    for (const m of input.memberships ?? []) {
      await setOneMember(actor, m.bucket, saved.id, m, requestId, { skipPermissionCheck: true });
    }
    return {
      person: publicPerson(store.person(saved.id)),
      invite: { token, expiresAt: record.expiresAt },
    };
  }

  async function patchPerson(actor, id, input, requestId) {
    const person = store.person(id);
    if (!person) fail('not_found', 'no such person');
    if (input.admin !== undefined && typeof input.admin !== 'boolean') {
      // `0`, `null` and `""` are all falsy, and a rule written as `=== false`
      // would wave them past while the write coerced them to false anyway.
      fail('invalid', 'admin must be a boolean');
    }
    if (input.status !== undefined && !['active', 'paused'].includes(input.status)) {
      fail('invalid', 'status must be active or paused');
    }

    const next = { ...person };
    for (const field of ['name', 'email']) {
      if (input[field] !== undefined) next[field] = input[field];
    }
    if (input.admin !== undefined) next.admin = input.admin;
    if (input.status !== undefined) next.status = input.status;

    // Decided from the object the write would produce, not from the fields the
    // caller happened to name.
    const wasActiveAdmin = person.admin && person.status === 'active';
    const stillActiveAdmin = next.admin && next.status === 'active';
    if (wasActiveAdmin && !stillActiveAdmin && activeAdmins().length <= 1) {
      fail('last_admin', 'the last active admin cannot be paused or demoted');
    }

    const saved = await guard(() => store.savePerson(next, person.etag));
    if (activeAdmins().length === 0) {
      // Another proxy removed the other admin between the check and the write.
      await store.savePerson({ ...person }, saved.etag).catch(() => {});
      fail('last_admin', 'the last active admin cannot be paused or demoted');
    }

    for (const [change, happened] of [
      ['paused', person.status === 'active' && saved.status === 'paused'],
      ['resumed', person.status === 'paused' && saved.status === 'active'],
      ['admin-granted', !person.admin && saved.admin],
      ['admin-removed', person.admin && !saved.admin],
    ]) if (happened) logChange(actor, requestId, change, saved);

    return { person: publicPerson(saved) };
  }

  async function resetPerson(actor, id, requestId) {
    const person = store.person(id);
    if (!person) fail('not_found', 'no such person');
    if (person.admin && person.status === 'active' && activeAdmins().length <= 1) {
      fail('last_admin', 'the last active admin cannot be reset');
    }
    const retiredAt = new Date().toISOString();
    const { token, record } = newInvite();
    const saved = await guard(() => store.savePerson({
      ...person,
      status: 'invited',
      invite: record,
      keys: (person.keys ?? []).map((k) => ({ ...k, retiredAt: k.retiredAt ?? retiredAt })),
    }, person.etag));
    // The same recheck PATCH does: a reset is the other way to lose the last
    // admin, and another proxy may have removed the other one in between.
    if (activeAdmins().length === 0) {
      await store.savePerson({ ...person }, saved.etag).catch(() => {});
      fail('last_admin', 'the last active admin cannot be reset');
    }
    logChange(actor, requestId, 'reset', person);
    return { invite: { token, expiresAt: record.expiresAt } };
  }

  function mayEdit(actor, collection) {
    const mine = collection.members.find((m) => m.personId === actor.id);
    if (!actor.admin && mine?.access !== 'run') {
      fail('forbidden', 'admin or run access on this collection is required');
    }
  }

  function validMember(m) {
    if (!store.person(m.personId)) fail('invalid', `no such person ${m.personId}`);
    if (!ACCESS_LEVELS.includes(m.access)) fail('invalid', `unknown access level ${m.access}`);
    if (m.exactLocations !== undefined && typeof m.exactLocations !== 'boolean') {
      fail('invalid', 'exactLocations must be a boolean');
    }
  }

  const stamp = (actor, m) => ({
    personId: m.personId,
    access: m.access,
    exactLocations: !!m.exactLocations,
    grantedBy: actor.id,
    grantedAt: new Date().toISOString(),
  });

  const hasRunner = (members) => members.some((m) => m.access === 'run');

  function requireRunner(members) {
    if (!hasRunner(members)) {
      fail('last_runner', 'a collection needs at least one member with run access');
    }
  }

  /**
   * The per-person form protects an existing runner rather than demanding one.
   * A collection with no members yet has to be able to receive its first, and
   * that first grant is not always `run`.
   */
  function requireNotStranded(before, after) {
    if (hasRunner(before) && !hasRunner(after)) {
      fail('last_runner', 'this would remove the collection\'s last member with run access');
    }
  }

  /** The whole-list form, guarded by the version the caller last read. */
  async function putMembers(actor, bucket, input, headers, requestId) {
    const collection = store.collection(bucket);
    if (!collection) fail('not_found', 'no such collection');
    mayEdit(actor, collection);

    const ifMatch = headers?.get?.('if-match') ?? null;
    const ifNoneMatch = headers?.get?.('if-none-match') ?? null;
    const version = collection.membersEtag ?? null;
    if (version === null) {
      if (ifNoneMatch !== '*') fail('changed_elsewhere', 'this collection has no members file yet');
    } else if (ifMatch !== version) {
      fail('changed_elsewhere', 'membersVersion is stale');
    }

    const members = (input.members ?? []).map((m) => { validMember(m); return stamp(actor, m); });
    requireRunner(members);

    const before = collection.members;
    const saved = await guard(() => store.saveMembers(bucket, members, version));
    logMemberDiff(actor, requestId, collection, before, saved.members);
    return { members: saved.members, membersVersion: saved.membersEtag ?? null };
  }

  /**
   * The per-person form. The read-modify-write is the server's, so two admins
   * editing different people in one collection do not have to take turns.
   */
  async function editOneMember(actor, bucket, mutate, requestId, { skipPermissionCheck } = {}) {
    for (let attempt = 0; ; attempt += 1) {
      const collection = store.collection(bucket);
      if (!collection) fail('not_found', `no such collection ${bucket}`);
      if (!skipPermissionCheck) mayEdit(actor, collection);

      const before = collection.members;
      const members = mutate(before);
      requireNotStranded(before, members);
      try {
        const saved = await store.saveMembers(bucket, members, collection.membersEtag ?? null);
        logMemberDiff(actor, requestId, collection, before, saved.members);
        return { members: saved.members, membersVersion: saved.membersEtag ?? null };
      } catch (err) {
        if (!(err instanceof Conflict) || attempt >= 2) {
          if (err instanceof Conflict) fail('changed_elsewhere', err.message);
          throw err;
        }
        await store.reload();
      }
    }
  }

  function setOneMember(actor, bucket, personId, input, requestId, options) {
    const member = { personId, access: input.access, exactLocations: input.exactLocations };
    validMember(member);
    return editOneMember(actor, bucket, (members) => [
      ...members.filter((m) => m.personId !== personId),
      stamp(actor, member),
    ], requestId, options);
  }

  function removeOneMember(actor, bucket, personId, requestId) {
    return editOneMember(
      actor, bucket, (members) => members.filter((m) => m.personId !== personId), requestId,
    );
  }

  function logMemberDiff(actor, requestId, collection, before, after) {
    const byId = (list) => new Map(list.map((m) => [m.personId, m]));
    const was = byId(before);
    const is = byId(after);
    const context = { bucket: collection.bucket, collectionName: collection.name ?? null };
    for (const [id, m] of is) {
      const old = was.get(id);
      const target = store.person(id) ?? { id, name: null };
      if (!old) logChange(actor, requestId, 'added', target, { ...context, after: membership(m) });
      else if (old.access !== m.access || !!old.exactLocations !== !!m.exactLocations) {
        logChange(actor, requestId, 'changed', target, {
          ...context, before: membership(old), after: membership(m),
        });
      }
    }
    for (const [id, m] of was) {
      if (is.has(id)) continue;
      const target = store.person(id) ?? { id, name: null };
      logChange(actor, requestId, 'removed', target, { ...context, before: membership(m) });
    }
  }

  async function guard(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Conflict) fail('changed_elsewhere', err.message);
      throw err;
    }
  }

  return { handle, INVITE_TTL_MS };
}
