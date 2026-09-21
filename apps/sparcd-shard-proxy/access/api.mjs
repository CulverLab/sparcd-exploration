// The `/-/` JSON API: who you are, who everyone is, and who may do what.
//
// It shares the S3 origin and the S3 signature check — a caller signs an API
// call with the same key pair it signs a GetObject with — so the admin app
// needs one credential and no second login. `/-/join` and `/-/health` are the
// exceptions, since a joining person has no key yet.

import { Conflict } from './store.mjs';
import {
  INVITE_TTL_MS, inviteMatches, newAccessKeyId, newInvite, newPersonId,
  newSecretKey, wrapSecret,
} from './keys.mjs';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const bad = (status, code, message) => { throw new ApiError(status, code, message); };

const publicPerson = (p) => ({
  id: p.id, name: p.name, email: p.email, status: p.status, admin: !!p.admin,
});

export function makeApi({ store, activity, masterKey, publicEndpoint, lastActive }) {
  const collectionsFor = (personId) =>
    store.collections()
      .map((c) => ({ c, m: c.members.find((m) => m.personId === personId) }))
      .filter(({ m }) => m)
      .map(({ c, m }) => ({
        bucket: c.bucket, uuid: c.uuid, name: c.name,
        access: m.access, exactLocations: !!m.exactLocations,
      }));

  const requireAdmin = (person) => {
    if (!person?.admin) bad(403, 'Forbidden', 'admin only');
  };

  const activeAdmins = () =>
    store.people().filter((p) => p.admin && p.status === 'active');

  function logAccessChange(person, detail, bucket) {
    activity.record({
      requestId: detail.requestId,
      personId: person?.id ?? null,
      personName: person?.name ?? null,
      kind: 'access-change',
      bucket: bucket ?? null,
      status: 200,
      detail: { before: detail.before, after: detail.after },
    });
  }

  /**
   * @param person null for the unauthenticated routes.
   * @returns `{ status, body }`; throws ApiError otherwise.
   */
  async function handle({ method, path, query, body, person, requestId }) {
    const json = () => (body?.length ? JSON.parse(Buffer.from(body).toString('utf8')) : {});

    if (path === '/-/health' && method === 'GET') return { status: 200, body: { ok: true } };

    if (path === '/-/join' && method === 'POST') {
      return { status: 200, body: await join(json().token, requestId) };
    }

    if (!person) bad(403, 'Forbidden', 'signature required');
    if (person.status !== 'active') bad(403, 'Forbidden', `person is ${person.status}`);

    if (path === '/-/whoami' && method === 'GET') {
      return {
        status: 200,
        body: { ...publicPerson(person), collections: collectionsFor(person.id) },
      };
    }

    const membersMatch = /^\/-\/admin\/collections\/([^/]+)\/members$/.exec(path);
    if (membersMatch && method === 'PUT') {
      return { status: 200, body: await putMembers(person, decodeURIComponent(membersMatch[1]), json(), requestId) };
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

    const personMatch = /^\/-\/admin\/people\/([^/]+)$/.exec(path);
    if (personMatch && method === 'PATCH') {
      requireAdmin(person);
      return { status: 200, body: await patchPerson(person, decodeURIComponent(personMatch[1]), json(), requestId) };
    }

    const resetMatch = /^\/-\/admin\/people\/([^/]+)\/reset$/.exec(path);
    if (resetMatch && method === 'POST') {
      requireAdmin(person);
      return { status: 200, body: await resetPerson(person, decodeURIComponent(resetMatch[1]), requestId) };
    }

    if (path === '/-/admin/collections' && method === 'GET') {
      requireAdmin(person);
      return {
        status: 200,
        body: {
          collections: store.collections().map((c) => ({
            bucket: c.bucket, uuid: c.uuid, name: c.name, organization: c.organization ?? null,
            members: c.members.map((m) => ({
              ...m, name: store.person(m.personId)?.name ?? null,
            })),
          })),
        },
      };
    }

    if (path === '/-/admin/activity' && method === 'GET') {
      requireAdmin(person);
      await activity.drain();
      const limit = query.get('limit') ? Number(query.get('limit')) : 200;
      return {
        status: 200,
        body: await activity.query({
          from: query.get('from') ?? undefined,
          to: query.get('to') ?? undefined,
          person: query.get('person') ?? undefined,
          bucket: query.get('bucket') ?? undefined,
          kind: query.get('kind') ?? undefined,
          limit,
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
        }),
      };
    }

    bad(404, 'NotFound', 'no such endpoint');
    return null;
  }

  async function join(token, requestId) {
    if (!token) bad(404, 'NotFound', 'no such invite');
    const person = store.people().find((p) => inviteMatches(p.invite, token));
    // One 404 for unknown, used and expired alike: distinguishing them tells a
    // guesser which tokens once existed.
    if (!person || person.status !== 'invited') bad(404, 'NotFound', 'no such invite');

    const secretKey = newSecretKey();
    const accessKey = newAccessKeyId();
    const next = {
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
    };
    await store.savePerson(next, person.etag);
    logAccessChange(person, {
      requestId, before: { status: 'invited' }, after: { status: 'active', accessKey },
    });
    return { endpoint: publicEndpoint, accessKey, secretKey, name: person.name };
  }

  async function createPerson(actor, input, requestId) {
    if (!input.name || !input.email) bad(400, 'BadRequest', 'name and email are required');
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
    for (const m of input.memberships ?? []) {
      await setMember(actor, m.bucket, {
        personId: saved.id, access: m.access, exactLocations: !!m.exactLocations,
      }, requestId);
    }
    logAccessChange(actor, { requestId, before: null, after: publicPerson(saved) });
    return {
      person: publicPerson(store.person(saved.id)),
      invite: { token, expiresAt: record.expiresAt },
    };
  }

  async function patchPerson(actor, id, input, requestId) {
    const person = store.person(id);
    if (!person) bad(404, 'NotFound', 'no such person');

    const losingAdmin = (input.admin === false && person.admin)
      || (input.status === 'paused' && person.admin && person.status === 'active');
    if (losingAdmin && activeAdmins().length <= 1) {
      bad(409, 'Conflict', 'the last active admin cannot be paused or demoted');
    }
    if (input.status && !['active', 'paused'].includes(input.status)) {
      bad(400, 'BadRequest', 'status must be active or paused');
    }

    const next = { ...person };
    for (const field of ['name', 'email']) {
      if (input[field] !== undefined) next[field] = input[field];
    }
    if (input.admin !== undefined) next.admin = !!input.admin;
    if (input.status !== undefined) next.status = input.status;

    const saved = await guard(() => store.savePerson(next, person.etag));
    logAccessChange(actor, {
      requestId, before: publicPerson(person), after: publicPerson(saved),
    });
    return { person: publicPerson(saved) };
  }

  async function resetPerson(actor, id, requestId) {
    const person = store.person(id);
    if (!person) bad(404, 'NotFound', 'no such person');
    if (person.admin && person.status === 'active' && activeAdmins().length <= 1) {
      bad(409, 'Conflict', 'the last active admin cannot be reset');
    }
    const retiredAt = new Date().toISOString();
    const { token, record } = newInvite();
    const next = {
      ...person,
      status: 'invited',
      invite: record,
      keys: (person.keys ?? []).map((k) => ({ ...k, retiredAt: k.retiredAt ?? retiredAt })),
    };
    await guard(() => store.savePerson(next, person.etag));
    logAccessChange(actor, {
      requestId, before: { status: person.status }, after: { status: 'invited', reset: true },
    });
    return { invite: { token, expiresAt: record.expiresAt } };
  }

  async function putMembers(actor, bucket, input, requestId) {
    const collection = store.collection(bucket);
    if (!collection) bad(404, 'NotFound', 'no such collection');
    const mine = collection.members.find((m) => m.personId === actor.id);
    if (!actor.admin && mine?.access !== 'run') {
      bad(403, 'Forbidden', 'admin or run access on this collection is required');
    }
    const members = (input.members ?? []).map((m) => {
      if (!store.person(m.personId)) bad(400, 'BadRequest', `no such person ${m.personId}`);
      if (!['look', 'identify', 'upload', 'run'].includes(m.access)) {
        bad(400, 'BadRequest', `unknown access level ${m.access}`);
      }
      return {
        personId: m.personId,
        access: m.access,
        exactLocations: !!m.exactLocations,
        grantedBy: actor.id,
        grantedAt: new Date().toISOString(),
      };
    });
    if (!members.some((m) => m.access === 'run')) {
      bad(409, 'Conflict', 'a collection needs at least one member with run access');
    }
    const before = collection.members;
    const saved = await guard(() => store.saveMembers(bucket, members, collection.membersEtag));
    logAccessChange(actor, { requestId, before, after: saved }, bucket);
    return { members: saved };
  }

  /** Add or replace one membership, leaving the rest alone. */
  async function setMember(actor, bucket, member, requestId) {
    const collection = store.collection(bucket);
    if (!collection) bad(400, 'BadRequest', `no such collection ${bucket}`);
    const rest = collection.members.filter((m) => m.personId !== member.personId);
    const next = [...rest, { ...member, grantedBy: actor.id, grantedAt: new Date().toISOString() }];
    const saved = await guard(() => store.saveMembers(bucket, next, collection.membersEtag));
    logAccessChange(actor, { requestId, before: collection.members, after: saved }, bucket);
  }

  async function guard(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Conflict) bad(412, 'PreconditionFailed', err.message);
      throw err;
    }
  }

  return { handle, INVITE_TTL_MS };
}
