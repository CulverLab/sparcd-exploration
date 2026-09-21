// The proxy end to end, against a MinIO on loopback that this file starts and
// tears down. Clients are the real AWS SDK and real SigV4 signing, holding
// keys the proxy issued.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  ListBucketsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand,
  DeleteObjectCommand, ListObjectsV2Command, HeadBucketCommand,
  CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';

import {
  startMinio, stopMinio, seed, startProxy, caller, rawSignedRequest, rawTarget,
  BUCKET_A, BUCKET_B, SETTINGS, CANARY, CANARY_KEY, CANARY_BODY,
  UUID_A, UUID_B, NAMESPACE,
} from './harness.mjs';

let endpoint;
let root;
let proxy;
let origin;
let admin;
const people = {};
const invites = {};

const prefixA = `Collections/${UUID_A}/Uploads/2026.01.01.00.00.00_seed`;
const prefixB = `Collections/${UUID_B}/Uploads/2026.01.01.00.00.00_seed`;

/** The opaque version an admin has to echo back to edit a member list. */
const membersVersion = async (bucket) => {
  const res = await people.admin.api('GET', '/-/admin/collections');
  return res.body.collections.find((c) => c.bucket === bucket).membersVersion;
};

const status = async (promise) => {
  try {
    await promise;
    return 200;
  } catch (err) {
    return err.$metadata?.httpStatusCode ?? 0;
  }
};

before(async () => {
  endpoint = await startMinio();
  root = await seed(endpoint);
  ({ proxy, origin, admin } = await startProxy(endpoint));
  people.admin = caller(origin, admin);

  const invite = async (name, memberships) => {
    const res = await people.admin.api('POST', '/-/admin/people', {
      name, email: `${name}@example.org`, memberships,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    invites[name] = res.body.invite;
    return res.body.person;
  };

  await invite('alice', [
    { bucket: BUCKET_A, access: 'run' }, { bucket: BUCKET_B, access: 'look' },
  ]);
  await invite('bob', [{ bucket: BUCKET_A, access: 'upload' }]);
  await invite('carol', [
    { bucket: BUCKET_A, access: 'identify' }, { bucket: BUCKET_B, access: 'run' },
  ]);

  for (const name of ['alice', 'bob', 'carol']) {
    const res = await fetch(`${origin}/-/join`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: invites[name].token }),
    });
    assert.equal(res.status, 200);
    people[name] = caller(origin, await res.json());
  }
});

after(async () => {
  await proxy?.close();
  await stopMinio();
});

describe('invariant 1: nothing outside the namespace', () => {
  test('the canary bucket is invisible in ListBuckets', async () => {
    for (const who of ['admin', 'alice', 'carol']) {
      const out = await people[who].s3().send(new ListBucketsCommand({}));
      const names = out.Buckets.map((b) => b.Name);
      assert.equal(names.includes(CANARY), false, who);
      assert.equal(names.some((n) => n.startsWith(NAMESPACE)), false, `${who} sees a raw name`);
    }
  });

  test('each person sees only their own collections, everyone sees settings', async () => {
    const names = async (who) =>
      (await people[who].s3().send(new ListBucketsCommand({}))).Buckets.map((b) => b.Name).sort();
    assert.deepEqual(await names('admin'), [BUCKET_B, BUCKET_A, SETTINGS].sort());
    assert.deepEqual(await names('bob'), [BUCKET_A, SETTINGS].sort());
    assert.deepEqual(await names('carol'), [BUCKET_A, BUCKET_B, SETTINGS].sort());
  });

  test('every verb on the canary bucket is refused, for an admin and a member', async () => {
    for (const who of ['admin', 'alice']) {
      const c = people[who];
      for (const method of ['GET', 'HEAD', 'PUT', 'POST', 'DELETE']) {
        const res = await c.raw(method, `/${CANARY}/${CANARY_KEY}`, {
          body: method === 'GET' || method === 'HEAD' ? undefined : 'x',
        });
        assert.equal(res.status, 403, `${who} ${method}`);
        assert.equal(res.text.includes(CANARY_BODY), false);
      }
    }
  });

  test('crafted bucket names do not reach the canary', async () => {
    const crafted = [
      `/../${CANARY}/${CANARY_KEY}`,
      `/%2e%2e/${CANARY}/${CANARY_KEY}`,
      `/sparcd%2F..%2F${CANARY}/${CANARY_KEY}`,
      `/${CANARY.toUpperCase()}/${CANARY_KEY}`,
      `/${NAMESPACE}${CANARY}/${CANARY_KEY}`,
      `/${NAMESPACE}${BUCKET_A}/${prefixA}/a.jpg`,
      `//${CANARY_KEY}`,
      `/${CANARY}.${CANARY}/${CANARY_KEY}`,
    ];
    for (const who of ['admin', 'alice']) {
      for (const path of crafted) {
        const res = await rawSignedRequest({
          origin, key: people[who].accessKey, secret: people[who].secretKey, path,
        });
        // 400 for the targets the request line itself refuses, 403 for the
        // rest. Either way nothing of the canary comes back.
        assert.ok([400, 403].includes(res.status), `${who} ${path} → ${res.status}`);
        assert.equal(res.text.includes(CANARY_BODY), false, path);
      }
    }
  });

  test('the canary is still there, read with the upstream credential', async () => {
    const got = await root.get(CANARY, CANARY_KEY);
    assert.equal(got.text, CANARY_BODY);
  });
});

describe('the access table', () => {
  const mediaA = `${prefixA}/a.jpg`;
  const mediaB = `${prefixB}/a.jpg`;

  test('reads are open to every member of a collection, closed to non-members', async () => {
    for (const who of ['admin', 'alice', 'bob', 'carol']) {
      assert.equal(
        await status(people[who].s3().send(new GetObjectCommand({ Bucket: BUCKET_A, Key: mediaA }))),
        200, `${who} get A`,
      );
      assert.equal(
        await status(people[who].s3().send(new ListObjectsV2Command({ Bucket: BUCKET_A }))),
        200, `${who} list A`,
      );
      assert.equal(
        await status(people[who].s3().send(new HeadBucketCommand({ Bucket: BUCKET_A }))),
        200, `${who} head A`,
      );
    }
    // bob has no membership on B.
    assert.equal(
      await status(people.bob.s3().send(new GetObjectCommand({ Bucket: BUCKET_B, Key: mediaB }))),
      403,
    );
    assert.equal(
      await status(people.bob.s3().send(new ListObjectsV2Command({ Bucket: BUCKET_B }))),
      403,
    );
  });

  test('PutObject follows the level, on both collections', async () => {
    const cases = [
      // [person, bucket, key, expected]
      ['carol', BUCKET_A, `${prefixA}/observations.csv`, 200], // identify: a Tagger file
      ['carol', BUCKET_A, `${prefixA}/new.jpg`, 403], // identify: not a Tagger file
      ['carol', BUCKET_A, `${prefixA}/deployments.csv`, 403], // the Uploader's, not the Tagger's
      ['bob', BUCKET_A, `${prefixA}/new.jpg`, 200], // upload
      ['bob', BUCKET_A, `Collections/${UUID_A}/species.json`, 403], // upload is not run
      ['alice', BUCKET_A, `Collections/${UUID_A}/species.json`, 200], // run
      ['alice', BUCKET_A, `Collections/${UUID_A}/other.json`, 403], // not one of the three
      ['alice', BUCKET_B, `${prefixB}/new.jpg`, 403], // look on B
      ['carol', BUCKET_B, `${prefixB}/new.jpg`, 200], // run on B
      ['admin', BUCKET_B, `${prefixB}/admin.jpg`, 200],
    ];
    for (const [who, bucket, key, expected] of cases) {
      assert.equal(
        await status(people[who].s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: 'x' }))),
        expected, `${who} PUT ${bucket}/${key}`,
      );
    }
  });

  test('the Tagger snapshot tree is writable at identify', async () => {
    const key = `${prefixA}/.sparcd-tagger-snapshots/carol%40example.org/2026-01-01T00-00-00/manifest.json`;
    assert.equal(
      await status(people.carol.s3().send(new PutObjectCommand({ Bucket: BUCKET_A, Key: key, Body: '{}' }))),
      200,
    );
  });

  test('DeleteObject needs run', async () => {
    const key = `${prefixA}/doomed.jpg`;
    await people.bob.s3().send(new PutObjectCommand({ Bucket: BUCKET_A, Key: key, Body: 'x' }));
    assert.equal(
      await status(people.bob.s3().send(new DeleteObjectCommand({ Bucket: BUCKET_A, Key: key }))),
      403,
    );
    assert.equal(
      await status(people.carol.s3().send(new DeleteObjectCommand({ Bucket: BUCKET_A, Key: key }))),
      403, 'identify may not delete',
    );
    assert.equal(
      await status(people.alice.s3().send(new DeleteObjectCommand({ Bucket: BUCKET_A, Key: key }))),
      200,
    );
  });

  test('multipart needs upload', async () => {
    const key = `${prefixA}/multi.bin`;
    assert.equal(
      await status(people.carol.s3().send(new CreateMultipartUploadCommand({ Bucket: BUCKET_A, Key: key }))),
      403,
    );
    assert.equal(
      await status(people.bob.s3().send(new CreateMultipartUploadCommand({ Bucket: BUCKET_A, Key: key }))),
      200,
    );
  });

  test('the operations the contract refuses outright', async () => {
    for (const who of ['admin', 'alice']) {
      for (const path of [
        `/${BUCKET_A}?acl=`, `/${BUCKET_A}?policy=`, `/${BUCKET_A}?versioning=`,
        `/${BUCKET_A}/${prefixA}/a.jpg?acl=`, `/${BUCKET_A}/${prefixA}/a.jpg?tagging=`,
      ]) {
        const res = await rawSignedRequest({
          origin, key: people[who].accessKey, secret: people[who].secretKey, path,
        });
        assert.equal(res.status, 403, `${who} ${path}`);
      }
    }
    // CopyObject is a PutObject with a source header.
    const copy = await people.admin.raw('PUT', `/${BUCKET_A}/${prefixA}/copy.jpg`, {
      body: '', headers: { 'x-amz-copy-source': `/${CANARY}/${CANARY_KEY}` },
    });
    assert.equal(copy.status, 403);
  });

  test('the settings bucket is readable by everyone active and written by nobody', async () => {
    for (const who of ['admin', 'alice', 'bob', 'carol']) {
      assert.equal(
        await status(people[who].s3().send(
          new GetObjectCommand({ Bucket: SETTINGS, Key: 'Settings/locations.json' }))),
        200, who,
      );
    }
    assert.equal(
      await status(people.alice.s3().send(
        new PutObjectCommand({ Bucket: SETTINGS, Key: 'Settings/locations.json', Body: '{}' }))),
      403,
    );
  });
});

describe('invariant 4: access data is proxy-owned', () => {
  const protectedKeys = [
    [SETTINGS, 'Settings/access/generation.json'],
    [SETTINGS, 'Settings/access/people/anything.json'],
    [BUCKET_A, `Collections/${UUID_A}/members.json`],
  ];

  test('an admin cannot write them directly', async () => {
    for (const [bucket, key] of protectedKeys) {
      assert.equal(
        await status(people.admin.s3().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: '{}' }))),
        403, `PUT ${bucket}/${key}`,
      );
      assert.equal(
        await status(people.admin.s3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))),
        403, `DELETE ${bucket}/${key}`,
      );
    }
  });

  test('an admin cannot read the wrapped secrets, directly or by listing', async () => {
    assert.equal(
      await status(people.admin.s3().send(
        new GetObjectCommand({ Bucket: SETTINGS, Key: 'Settings/access/generation.json' }))),
      403,
    );
    assert.equal(
      await status(people.admin.s3().send(
        new HeadObjectCommand({ Bucket: SETTINGS, Key: 'Settings/access/generation.json' }))),
      403,
    );
    const listing = await people.admin.s3().send(
      new ListObjectsV2Command({ Bucket: SETTINGS, Prefix: 'Settings/' }));
    const keys = (listing.Contents ?? []).map((o) => o.Key);
    assert.equal(keys.some((k) => k.startsWith('Settings/access/')), false);
  });

  test('a non-admin cannot read the activity tree, an admin can', async () => {
    await people.admin.api('GET', '/-/admin/activity?limit=1');
    const activityKeys = await root.listKeys(`${NAMESPACE}${SETTINGS}`, 'Settings/activity/');
    assert.ok(activityKeys.length > 0, 'the proxy wrote activity');
    const key = activityKeys[0];
    assert.equal(
      await status(people.alice.s3().send(new GetObjectCommand({ Bucket: SETTINGS, Key: key }))),
      403,
    );
    assert.equal(
      await status(people.admin.s3().send(new GetObjectCommand({ Bucket: SETTINGS, Key: key }))),
      200,
    );
    assert.equal(
      await status(people.admin.s3().send(new PutObjectCommand({ Bucket: SETTINGS, Key: key, Body: 'x' }))),
      403,
    );
  });
});

describe('joining, pausing and resetting', () => {
  test('a token burns on first use', async () => {
    const res = await fetch(`${origin}/-/join`, {
      method: 'POST', body: JSON.stringify({ token: invites.alice.token }),
    });
    assert.equal(res.status, 404);
  });

  test('an unknown token is a 404', async () => {
    const res = await fetch(`${origin}/-/join`, {
      method: 'POST', body: JSON.stringify({ token: 'not-a-token' }),
    });
    assert.equal(res.status, 404);
  });

  test('an expired token is a 404', async () => {
    const created = await people.admin.api('POST', '/-/admin/people', {
      name: 'expired', email: 'expired@example.org',
    });
    const id = created.body.person.id;
    // Age the invite out of band, then make the proxy notice.
    const bucket = `${NAMESPACE}${SETTINGS}`;
    const key = `Settings/access/people/${id}.json`;
    const current = await root.getJson(bucket, key);
    await root.put(bucket, key, JSON.stringify({
      ...current.value,
      invite: { ...current.value.invite, expiresAt: new Date(Date.now() - 1000).toISOString() },
    }), { ifMatch: current.etag });
    await proxy.store.reload();

    const res = await fetch(`${origin}/-/join`, {
      method: 'POST', body: JSON.stringify({ token: created.body.invite.token }),
    });
    assert.equal(res.status, 404);
  });

  test('whoami reports the memberships the table is decided from', async () => {
    const res = await people.carol.api('GET', '/-/whoami');
    assert.equal(res.status, 200);
    const byBucket = Object.fromEntries(res.body.collections.map((c) => [c.bucket, c.access]));
    assert.deepEqual(byBucket, { [BUCKET_A]: 'identify', [BUCKET_B]: 'run' });
    assert.equal(res.body.admin, false);
  });

  test('a paused person is refused everywhere, and comes back on resume', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const bob = list.body.people.find((p) => p.name === 'bob');
    assert.equal((await people.admin.api('PATCH', `/-/admin/people/${bob.id}`, { status: 'paused' })).status, 200);

    assert.equal(
      await status(people.bob.s3().send(new GetObjectCommand({ Bucket: BUCKET_A, Key: `${prefixA}/a.jpg` }))),
      403,
    );
    assert.equal(
      await status(people.bob.s3().send(new ListBucketsCommand({}))),
      403,
    );
    assert.equal((await people.bob.api('GET', '/-/whoami')).status, 403);

    assert.equal((await people.admin.api('PATCH', `/-/admin/people/${bob.id}`, { status: 'active' })).status, 200);
    assert.equal(
      await status(people.bob.s3().send(new GetObjectCommand({ Bucket: BUCKET_A, Key: `${prefixA}/a.jpg` }))),
      200,
    );
  });

  test('a reset retires the old key at once', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const carolId = list.body.people.find((p) => p.name === 'carol').id;
    const before = await status(
      people.carol.s3().send(new GetObjectCommand({ Bucket: BUCKET_A, Key: `${prefixA}/a.jpg` })));
    assert.equal(before, 200);

    const reset = await people.admin.api('POST', `/-/admin/people/${carolId}/reset`);
    assert.equal(reset.status, 200);
    assert.equal(
      await status(people.carol.s3().send(new GetObjectCommand({ Bucket: BUCKET_A, Key: `${prefixA}/a.jpg` }))),
      403,
    );

    const joined = await fetch(`${origin}/-/join`, {
      method: 'POST', body: JSON.stringify({ token: reset.body.invite.token }),
    });
    assert.equal(joined.status, 200);
    people.carol = caller(origin, await joined.json());
    assert.equal(
      await status(people.carol.s3().send(new GetObjectCommand({ Bucket: BUCKET_A, Key: `${prefixA}/a.jpg` }))),
      200,
    );
  });
});

describe('conflicts', () => {
  test('the last active admin cannot be paused or demoted', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const me = list.body.people.find((p) => p.admin && p.status === 'active');
    assert.equal((await people.admin.api('PATCH', `/-/admin/people/${me.id}`, { status: 'paused' })).status, 409);
    assert.equal((await people.admin.api('PATCH', `/-/admin/people/${me.id}`, { admin: false })).status, 409);
    assert.equal((await people.admin.api('POST', `/-/admin/people/${me.id}/reset`)).status, 409);
  });

  test('a collection cannot lose its last run member', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const id = (name) => list.body.people.find((p) => p.name === name).id;
    const res = await people.admin.api('PUT', `/-/admin/collections/${BUCKET_A}/members`, {
      members: [{ personId: id('alice'), access: 'look' }, { personId: id('bob'), access: 'upload' }],
    }, { 'if-match': await membersVersion(BUCKET_A) });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'last_runner');
  });

  test('a run member may edit the members of their own collection', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const id = (name) => list.body.people.find((p) => p.name === name).id;
    const res = await people.alice.api('PUT', `/-/admin/collections/${BUCKET_A}/members`, {
      members: [
        { personId: id('alice'), access: 'run' },
        { personId: id('bob'), access: 'upload' },
        { personId: id('carol'), access: 'identify' },
      ],
    }, { 'if-match': await membersVersion(BUCKET_A) });
    assert.equal(res.status, 200);
    assert.ok(res.body.membersVersion, 'no membersVersion came back');
    // bob has no run on A, so he may not.
    const bob = await people.bob.api('PUT', `/-/admin/collections/${BUCKET_A}/members`, {
      members: res.body.members,
    }, { 'if-match': res.body.membersVersion });
    assert.equal(bob.status, 403);
    assert.equal(bob.body.error.code, 'forbidden');
  });

  test('a concurrent member edit loses on If-Match', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const id = (name) => list.body.people.find((p) => p.name === name).id;
    const bucket = `${NAMESPACE}${BUCKET_A}`;
    const key = `Collections/${UUID_A}/members.json`;

    // Someone else wrote members.json without bumping the generation, so the
    // proxy's cached ETag is stale and its next guarded write must lose. The
    // body has to differ, or MinIO hands back the same content-hash ETag and
    // nothing is stale at all.
    const current = await root.getJson(bucket, key);
    const touched = {
      ...current.value,
      members: current.value.members.map((m) => ({ ...m, grantedAt: new Date().toISOString() })),
    };
    assert.equal(await root.put(bucket, key, JSON.stringify(touched), { ifMatch: current.etag }), true);

    const res = await people.admin.api('PUT', `/-/admin/collections/${BUCKET_A}/members`, {
      members: [{ personId: id('alice'), access: 'run' }],
    }, { 'if-match': await membersVersion(BUCKET_A) });
    assert.equal(res.status, 412);
    assert.equal(res.body.error.code, 'changed_elsewhere');
    await proxy.store.reload();
  });

  test('a members edit without the version it read is refused', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const id = (name) => list.body.people.find((p) => p.name === name).id;
    const members = [{ personId: id('alice'), access: 'run' }];
    const naked = await people.admin.api(
      'PUT', `/-/admin/collections/${BUCKET_A}/members`, { members });
    assert.equal(naked.status, 412);
    assert.equal(naked.body.error.code, 'changed_elsewhere');
    const stale = await people.admin.api(
      'PUT', `/-/admin/collections/${BUCKET_A}/members`, { members },
      { 'if-match': '"not-the-version"' });
    assert.equal(stale.status, 412);
  });
});

describe('signature handling', () => {
  const path = `/${BUCKET_A}/${prefixA}/a.jpg`;

  test('a tampered signature is refused', async () => {
    const res = await rawSignedRequest({
      origin, key: people.alice.accessKey, secret: `${people.alice.secretKey}x`, path,
    });
    assert.equal(res.status, 403);
    assert.match(res.text, /SignatureDoesNotMatch/);
  });

  test('an unknown access key is refused', async () => {
    const res = await rawSignedRequest({
      origin, key: 'SPKAAAAAAAAAAAAAAAA', secret: 'nope', path,
    });
    assert.equal(res.status, 403);
  });

  test('an unsigned x-amz header is refused', async () => {
    const res = await people.alice.raw('GET', path, {
      unsignedHeaders: { 'x-amz-acl': 'public-read' },
    });
    assert.equal(res.status, 403);
    assert.match(res.text, /unsigned x-amz header/);
  });

  test('a body that does not match its declared hash is refused', async () => {
    const res = await people.alice.raw('PUT', `/${BUCKET_A}/${prefixA}/mismatch.jpg`, {
      body: 'actual bytes',
      headers: { 'x-amz-content-sha256': 'a'.repeat(64) },
    });
    assert.equal(res.status, 403);
    assert.match(res.text, /body does not match/);
  });

  test('a presigned GET works, and an over-long one does not', async () => {
    const good = await fetch(await people.alice.presign(path, 900));
    assert.equal(good.status, 200);
    assert.equal(await good.text(), `image-bytes-${UUID_A}`);

    const tooLong = await fetch(await people.alice.presign(path, 7200));
    assert.equal(tooLong.status, 403);
    assert.match(await tooLong.text(), /exceeds one hour/);
  });

  test('a presigned GET still obeys the rules', async () => {
    const res = await fetch(await people.bob.presign(`/${BUCKET_B}/${prefixB}/a.jpg`, 900));
    assert.equal(res.status, 403);
    const canary = await fetch(await people.admin.presign(`/${CANARY}/${CANARY_KEY}`, 900));
    assert.equal(canary.status, 403);
  });
});

describe('browser-shaped uploads', () => {
  test('PutObject with UNSIGNED-PAYLOAD, the shape a Blob body produces', async () => {
    const key = `${prefixA}/blob.jpg`;
    const res = await people.bob.raw('PUT', `/${BUCKET_A}/${key}`, {
      body: 'pretend-jpeg-bytes', unsigned: true,
    });
    assert.equal(res.status, 200);
    const got = await root.get(`${NAMESPACE}${BUCKET_A}`, key);
    assert.equal(got.text, 'pretend-jpeg-bytes');
  });

  test('a three-part multipart upload as an upload member', async () => {
    const key = `${prefixA}/big.bin`;
    const s3 = people.bob.s3();
    const created = await s3.send(new CreateMultipartUploadCommand({ Bucket: BUCKET_A, Key: key }));
    assert.equal(created.Bucket, BUCKET_A, 'the response names the client bucket');

    const part = (n) => Buffer.alloc(5 * 1024 * 1024, 64 + n);
    const parts = [];
    for (let n = 1; n <= 3; n += 1) {
      const out = await s3.send(new UploadPartCommand({
        Bucket: BUCKET_A, Key: key, UploadId: created.UploadId, PartNumber: n, Body: part(n),
      }));
      parts.push({ ETag: out.ETag, PartNumber: n });
    }
    const done = await s3.send(new CompleteMultipartUploadCommand({
      Bucket: BUCKET_A, Key: key, UploadId: created.UploadId, MultipartUpload: { Parts: parts },
    }));
    assert.equal(done.Bucket, BUCKET_A);

    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET_A, Key: key }));
    assert.equal(head.ContentLength, 15 * 1024 * 1024);
  });
});

describe('activity', () => {
  test('a download, a denial and an access change each leave a line', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const aliceId = list.body.people.find((p) => p.name === 'alice').id;

    const downloadKey = `${prefixA}/a.jpg`;
    await people.alice.s3().send(new GetObjectCommand({ Bucket: BUCKET_A, Key: downloadKey }));
    await status(people.alice.s3().send(
      new PutObjectCommand({ Bucket: BUCKET_B, Key: `${prefixB}/nope.jpg`, Body: 'x' })));
    await people.admin.api('PATCH', `/-/admin/people/${aliceId}`, { status: 'paused' });
    await people.admin.api('PATCH', `/-/admin/people/${aliceId}`, { status: 'active' });

    const all = await people.admin.api('GET', '/-/admin/activity?limit=1000');
    assert.equal(all.status, 200);
    const kinds = new Set(all.body.events.map((e) => e.kind));
    for (const kind of ['download', 'denied', 'access-change', 'sign-in']) {
      assert.ok(kinds.has(kind), `no ${kind} event`);
    }

    const download = all.body.events.find((e) => e.kind === 'download' && e.key === downloadKey);
    assert.equal(download.personId, aliceId);
    assert.equal(download.bucket, BUCKET_A);
    assert.equal(download.status, 200);

    const denied = all.body.events.find((e) => e.kind === 'denied' && e.bucket === BUCKET_B);
    assert.equal(denied.status, 403);
    assert.ok(denied.detail);

    const paused = all.body.events.find(
      (e) => e.kind === 'access-change' && e.detail?.change === 'paused'
        && e.detail?.target?.personId === aliceId);
    assert.equal(paused.detail.target.personName, 'alice');
    assert.ok(all.body.events.some(
      (e) => e.detail?.change === 'resumed' && e.detail?.target?.personId === aliceId));
    // A membership grant says which collection and what it became.
    const added = all.body.events.find((e) => e.detail?.change === 'added' && e.detail?.bucket);
    assert.equal(typeof added.detail.collectionName, 'string');
    assert.ok(['look', 'identify', 'upload', 'run'].includes(added.detail.after.access));

    // Newest first.
    const ts = all.body.events.map((e) => e.ts);
    assert.deepEqual(ts, [...ts].sort().reverse());
  });

  test('the downloads query finds it', async () => {
    const key = `${prefixA}/a.jpg`;
    const res = await people.admin.api(
      'GET', `/-/admin/activity/downloads?bucket=${BUCKET_A}&key=${encodeURIComponent(key)}`);
    assert.equal(res.status, 200);
    assert.ok(res.body.events.length > 0);
    assert.ok(res.body.events.every((e) => e.kind === 'download' && e.key === key));
  });

  test('a filtered query narrows, and a non-admin cannot ask', async () => {
    const res = await people.admin.api('GET', '/-/admin/activity?kind=download&limit=1');
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].kind, 'download');
    assert.equal(res.body.truncated, true);
    assert.equal((await people.alice.api('GET', '/-/admin/activity')).status, 403);
  });

  test('listings and metadata reads are not logged', async () => {
    await people.alice.s3().send(new ListObjectsV2Command({ Bucket: BUCKET_A }));
    await people.alice.s3().send(new HeadObjectCommand({ Bucket: BUCKET_A, Key: `${prefixA}/a.jpg` }));
    const res = await people.admin.api('GET', '/-/admin/activity?limit=1000');
    assert.equal(res.body.events.some((e) => e.kind === 'list' || e.kind === 'head'), false);
  });
});

describe('two proxies over one store', () => {
  test('an access change reaches the other proxy on the next poll', async () => {
    const second = await startProxy(endpoint, { pollMs: 200 }, { bootstrap: false });
    try {
      const list = await people.admin.api('GET', '/-/admin/people');
      const bobId = list.body.people.find((p) => p.name === 'bob').id;
      const bobOnSecond = caller(second.origin, {
        accessKey: people.bob.accessKey, secretKey: people.bob.secretKey,
      });
      assert.equal((await bobOnSecond.api('GET', '/-/whoami')).status, 200);

      await people.admin.api('PATCH', `/-/admin/people/${bobId}`, { status: 'paused' });
      const deadline = Date.now() + 5000;
      let seen;
      do {
        seen = (await bobOnSecond.api('GET', '/-/whoami')).status;
        if (seen === 403) break;
        await new Promise((r) => setTimeout(r, 100));
      } while (Date.now() < deadline);
      assert.equal(seen, 403, 'the pause did not propagate within 5 s');

      await people.admin.api('PATCH', `/-/admin/people/${bobId}`, { status: 'active' });
    } finally {
      await second.proxy.close();
    }
  });
});

describe('hardening', () => {
  const mediaA = `${prefixA}/a.jpg`;

  // 1 — the service root
  test('the service root takes no parameters', async () => {
    for (const query of ['?usage', '?format=json', '?acl', '?versions']) {
      const res = await rawSignedRequest({
        origin, key: people.admin.accessKey, secret: people.admin.secretKey, path: `/${query}`,
      });
      assert.equal(res.status, 403, query);
      assert.equal(res.text.includes(CANARY), false, query);
    }
  });

  test('the ListBuckets body is built here, not passed through', async () => {
    const res = await people.admin.raw('GET', '/');
    assert.equal(res.status, 200);
    assert.match(res.text, /<Owner><ID>sparcd<\/ID>/);
    assert.equal(res.text.includes(NAMESPACE + 'sparcd'), false);
    assert.equal(res.text.includes(CANARY), false);
    assert.equal(res.text.includes('CreationDate>2'), false, 'an upstream date survived');
  });

  test('a presigned request cannot reach the service root', async () => {
    const res = await fetch(await people.admin.presign('/', 900));
    assert.equal(res.status, 403);
  });

  // 2 — the x-amz-* allowlist
  test('an x-amz header outside the allowlist is refused, signed or not', async () => {
    for (const header of [
      'x-amz-acl', 'x-amz-grant-read', 'x-amz-storage-class', 'x-amz-tagging',
      'x-amz-server-side-encryption', 'x-amz-server-side-encryption-customer-key',
      'x-amz-website-redirect-location', 'x-amz-object-lock-mode', 'x-amz-trailer',
    ]) {
      const res = await people.alice.raw('PUT', `/${BUCKET_A}/${prefixA}/acl.jpg`, {
        body: 'x', headers: { [header]: 'value' },
      });
      assert.equal(res.status, 403, header);
      assert.match(res.text, /header not accepted|unsigned x-amz header/, header);
    }
  });

  test('the allowlisted ones still work, and the metadata arrives', async () => {
    const key = `${prefixA}/meta.jpg`;
    const res = await people.alice.raw('PUT', `/${BUCKET_A}/${key}`, {
      body: 'bytes',
      headers: {
        'x-amz-meta-sha256': 'abc123',
        'x-amz-meta-anything': 'also-fine',
        'x-amz-user-agent': 'aws-sdk-js/3.0.0',
      },
    });
    assert.equal(res.status, 200);
    const head = await people.alice.s3().send(
      new HeadObjectCommand({ Bucket: BUCKET_A, Key: key }));
    assert.equal(head.Metadata.sha256, 'abc123');
    assert.equal(head.Metadata.anything, 'also-fine');
    // Telemetry is accepted from the caller and dropped, not forwarded.
    assert.equal(head.Metadata['user-agent'], undefined);
  });

  // 3 — anonymous cost
  test('an unknown key is refused without the body being read', async () => {
    const res = await rawSignedRequest({
      origin, key: 'SPKZZZZZZZZZZZZZZZZ', secret: 'nope',
      method: 'PUT', path: `/${BUCKET_A}/${prefixA}/anon.jpg`,
    });
    assert.equal(res.status, 403);
    assert.match(res.text, /InvalidAccessKeyId/);
  });

  test('a body over the in-flight ceiling is 503, not heap', async () => {
    const small = await startProxy(endpoint, { maxBufferedBytes: 1024 }, { bootstrap: false });
    try {
      const who = caller(small.origin, {
        accessKey: people.alice.accessKey, secretKey: people.alice.secretKey,
      });
      const res = await who.raw('PUT', `/${BUCKET_A}/${prefixA}/big.jpg`, {
        body: 'x'.repeat(4096),
      });
      assert.equal(res.status, 503);
      assert.match(res.text, /SlowDown/);
      // Still serving afterwards.
      assert.equal((await who.raw('GET', `/${BUCKET_A}/${mediaA}`)).status, 200);
    } finally {
      await small.proxy.close();
    }
  });

  // 4 — a torn-down response does not take the process with it
  test('a client that walks away mid-download leaves the proxy serving', async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    await fetch(await people.alice.presign(`/${BUCKET_A}/${mediaA}`, 900), { signal })
      .then((r) => { controller.abort(); return r.text().catch(() => null); })
      .catch(() => null);
    assert.equal((await people.alice.raw('GET', `/${BUCKET_A}/${mediaA}`)).status, 200);
  });

  // 6 — the last-admin rule cannot be walked past with a falsy value
  test('a non-boolean admin flag is invalid, not a quiet demotion', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const me = list.body.people.find((p) => p.admin && p.status === 'active');
    for (const admin of [0, null, '', 'false']) {
      const res = await people.admin.api('PATCH', `/-/admin/people/${me.id}`, { admin });
      assert.equal(res.status, 400, JSON.stringify(admin));
      assert.equal(res.body.error.code, 'invalid');
    }
    const bad = await people.admin.api('PATCH', `/-/admin/people/${me.id}`, { status: 'retired' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error.code, 'invalid');
    // Still an admin.
    assert.equal((await people.admin.api('GET', '/-/admin/people')).status, 200);
  });

  // 7 — settings listings
  test('a listing aimed at a protected tree is refused, not emptied', async () => {
    for (const prefix of ['Settings/access/', 'Settings/acc', 'Settings/access/people/']) {
      const res = await status(people.admin.s3().send(
        new ListObjectsV2Command({ Bucket: SETTINGS, Prefix: prefix })));
      assert.equal(res, 403, prefix);
    }
    assert.equal(
      await status(people.alice.s3().send(
        new ListObjectsV2Command({ Bucket: SETTINGS, Prefix: 'Settings/activ' }))),
      403,
    );
    assert.equal(
      await status(people.admin.s3().send(
        new ListObjectsV2Command({ Bucket: SETTINGS, Prefix: 'Settings/activ' }))),
      200,
    );
  });

  test('a settings listing is one complete page with no continuation', async () => {
    const res = await people.alice.raw('GET', `/${SETTINGS}?list-type=2&prefix=Settings/`);
    assert.equal(res.status, 200);
    assert.match(res.text, /<IsTruncated>false<\/IsTruncated>/);
    assert.equal(res.text.includes('NextContinuationToken'), false);
    assert.equal(res.text.includes('Settings/access/'), false);
    assert.equal(res.text.includes('Settings/activity/'), false);
    assert.match(res.text, /<Name>sparcd-settings-test<\/Name>/);
  });

  // 8 — presigned writes
  test('a presigned PUT is refused', async () => {
    const url = await people.alice.presign(`/${BUCKET_A}/${prefixA}/presigned.jpg`, 900);
    const res = await fetch(url, { method: 'PUT', body: 'x' });
    assert.equal(res.status, 403);
    assert.match(await res.text(), /read-only/);
  });

  // 9 — host binding
  test('a Host this process does not answer for is refused', async () => {
    const { port } = new URL(origin);
    const res = await rawTarget(port, '/-/health', 'evil.example.org');
    assert.equal(res.status, 403);
    assert.match(res.text, /unknown host/);
    // The Host it does answer for still works.
    assert.equal((await rawTarget(port, '/-/health')).status, 200);
  });

  test('an absolute-form target is refused', async () => {
    const { port } = new URL(origin);
    const res = await rawTarget(port, `http://127.0.0.1:${port}/-/health`);
    assert.equal(res.status, 400);
    const slashes = await rawTarget(port, '//127.0.0.1/-/health');
    assert.equal(slashes.status, 400);
  });

  // 10 — preconditions travel only when signed
  test('a signed precondition reaches the upstream and an unsigned one does not', async () => {
    const key = `${prefixA}/precondition.jpg`;
    await people.alice.raw('PUT', `/${BUCKET_A}/${key}`, { body: 'first' });

    const signedGuard = await people.alice.raw('PUT', `/${BUCKET_A}/${key}`, {
      body: 'second', headers: { 'if-none-match': '*' },
    });
    assert.equal(signedGuard.status, 412, 'the signed precondition did not reach the upstream');

    const unsignedGuard = await people.alice.raw('PUT', `/${BUCKET_A}/${key}`, {
      body: 'third', unsignedHeaders: { 'if-none-match': '*' },
    });
    assert.equal(unsignedGuard.status, 200, 'an unsigned precondition was honoured');
  });

  // 11 — what an error body says
  test('an upstream error names no host or resource', async () => {
    const res = await people.alice.raw('GET', `/${BUCKET_A}/${prefixA}/no-such-object.jpg`);
    assert.equal(res.status, 404);
    assert.equal(res.text.includes('<Resource>'), false);
    assert.equal(res.text.includes('<HostId>'), false);
    assert.equal(res.text.includes(NAMESPACE + BUCKET_A), false);
  });

  test('the process refuses to start without PUBLIC_ENDPOINT or ALLOWED_HOSTS', async () => {
    await assert.rejects(
      () => startProxy(endpoint, { publicEndpoint: null }, { bootstrap: false }),
      /PUBLIC_ENDPOINT is required/,
    );
    await assert.rejects(
      () => startProxy(endpoint, { allowedHosts: '' }, { bootstrap: false }),
      /ALLOWED_HOSTS is required/,
    );
  });

  // 12 — object keys
  test('a key with a traversal, a backslash or a dot segment is refused', async () => {
    // Sent raw: a URL parser would normalise `..` and `.` away long before the
    // proxy saw them, which is exactly why the check has to be on the wire
    // form and exactly why the test cannot use an SDK to ask.
    for (const key of [
      `Collections/${UUID_A}/Uploads/s/../../../etc`,
      `Collections/${UUID_A}/Uploads/./s/a.jpg`,
      `Collections/${UUID_A}/Uploads/s/a%5Cb.jpg`,
    ]) {
      const res = await rawSignedRequest({
        origin, key: people.alice.accessKey, secret: people.alice.secretKey,
        method: 'PUT', path: `/${BUCKET_A}/${key}`,
      });
      assert.ok([400, 403].includes(res.status), `${key} → ${res.status}`);
    }
    // The same key without the dot segments is fine, so the refusal is about
    // the shape and not about the prefix.
    const ok = await rawSignedRequest({
      origin, key: people.alice.accessKey, secret: people.alice.secretKey,
      method: 'PUT', path: `/${BUCKET_A}/${prefixA}/plain.jpg`,
    });
    assert.equal(ok.status, 200);
  });

  // contract b — per-person membership
  test('one membership at a time, with the read-modify-write on the server', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const id = (name) => list.body.people.find((p) => p.name === name).id;

    const added = await people.admin.api(
      'PUT', `/-/admin/collections/${BUCKET_B}/members/${id('bob')}`,
      { access: 'upload', exactLocations: true });
    assert.equal(added.status, 200);
    assert.ok(added.body.membersVersion);
    const bobOnB = added.body.members.find((m) => m.personId === id('bob'));
    assert.equal(bobOnB.access, 'upload');
    assert.equal(bobOnB.exactLocations, true);
    assert.equal(
      await status(people.bob.s3().send(
        new GetObjectCommand({ Bucket: BUCKET_B, Key: `${prefixB}/a.jpg` }))),
      200,
    );

    const removed = await people.admin.api(
      'DELETE', `/-/admin/collections/${BUCKET_B}/members/${id('bob')}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.members.some((m) => m.personId === id('bob')), false);
    assert.equal(
      await status(people.bob.s3().send(
        new GetObjectCommand({ Bucket: BUCKET_B, Key: `${prefixB}/a.jpg` }))),
      403,
    );
  });

  test('a per-person edit that would strand the collection is refused', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const carolId = list.body.people.find((p) => p.name === 'carol').id;
    const res = await people.admin.api(
      'DELETE', `/-/admin/collections/${BUCKET_B}/members/${carolId}`);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'last_runner');
  });

  test('a per-person edit survives a stale cache by retrying', async () => {
    const list = await people.admin.api('GET', '/-/admin/people');
    const id = (name) => list.body.people.find((p) => p.name === name).id;
    const bucket = `${NAMESPACE}${BUCKET_B}`;
    const key = `Collections/${UUID_B}/members.json`;

    const current = await root.getJson(bucket, key);
    assert.equal(await root.put(bucket, key, JSON.stringify({
      ...current.value,
      members: current.value.members.map((m) => ({ ...m, grantedAt: new Date().toISOString() })),
    }), { ifMatch: current.etag }), true);

    const res = await people.admin.api(
      'PUT', `/-/admin/collections/${BUCKET_B}/members/${id('alice')}`, { access: 'look' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  // contract c and d
  test('every error code the suite provokes is one the contract publishes', async () => {
    const published = new Set([
      'invalid', 'forbidden', 'not_found', 'last_admin', 'last_runner',
      'changed_elsewhere', 'too_large', 'busy', 'upstream',
    ]);
    const provoked = [
      await people.alice.api('GET', '/-/admin/people'),
      await people.admin.api('GET', '/-/admin/people/nope'),
      await people.admin.api('PATCH', '/-/admin/people/nope', { name: 'x' }),
      await people.admin.api('POST', '/-/admin/people', { name: 'x' }),
      await people.admin.api('PUT', `/-/admin/collections/${BUCKET_A}/members`, { members: [] }),
    ];
    for (const res of provoked) {
      assert.ok(res.body?.error, JSON.stringify(res));
      assert.ok(published.has(res.body.error.code), res.body.error.code);
    }
  });

  test('lastActiveAt is an instant or null, and collections carry uuid', async () => {
    const res = await people.admin.api('GET', '/-/admin/people');
    for (const p of res.body.people) {
      assert.ok(p.lastActiveAt === null || !Number.isNaN(Date.parse(p.lastActiveAt)), p.name);
      for (const c of p.collections) {
        assert.equal(typeof c.uuid, 'string');
        assert.equal(typeof c.bucket, 'string');
      }
    }
    const me = res.body.people.find((p) => p.name === 'alice');
    assert.match(me.lastActiveAt, /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('health', () => {
  test('/-/health needs no signature', async () => {
    const res = await fetch(`${origin}/-/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});
