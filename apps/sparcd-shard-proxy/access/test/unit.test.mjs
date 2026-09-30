// No sockets, no containers: the pure parts of the proxy.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AwsClient } from 'aws4fetch';

import { verifySignature, canonicalQueryString, encodeRfc3986, sha256hex } from '../sigv4.mjs';
import {
  makeNamespace, bucketFromPath, keyFromPath, parseBucketNames, buildListBuckets,
  rewriteBucketName, safeKeySegments,
} from '../namespace.mjs';
import {
  classify, decide, eventKind, taggerWriteKey, uploadsKey, runDocumentKey,
} from '../rules.mjs';
import {
  loadMasterKey, wrapSecret, unwrapSecret, newAccessKeyId, newSecretKey,
  newInvite, inviteMatches, hashToken,
} from '../keys.mjs';
import { makeUpstream, normalizeIfMatch } from '../upstream.mjs';
import { makeStore, GENERATION_KEY, PEOPLE_PREFIX } from '../store.mjs';

const KEY = { accessKeyId: 'SPKABCDEFGHIJKLMNOP', secretAccessKey: 'a'.repeat(40) };
const lookup = (id) => (id === KEY.accessKeyId ? KEY.secretAccessKey : null);
const aws = new AwsClient({ ...KEY, service: 's3', region: 'us-east-1' });

/** Sign a request the way a browser S3 client would, then hand it to the verifier. */
async function signed(url, init = {}) {
  const req = await aws.sign(url, { ...init, aws: { ...init.aws } });
  const body = init.body === undefined ? undefined : Buffer.from(init.body);
  return {
    method: req.method,
    url: new URL(req.url),
    headers: req.headers,
    body,
    lookupSecret: lookup,
  };
}

describe('sigv4 header form', () => {
  test('a well-formed signature verifies', async () => {
    const input = await signed('https://shard.example.org/t-sparcd/Settings/x.json');
    const out = await verifySignature(input);
    assert.equal(out.error, undefined);
    assert.equal(out.accessKeyId, KEY.accessKeyId);
    assert.equal(out.presigned, false);
  });

  test('a tampered signature is rejected', async () => {
    const input = await signed('https://shard.example.org/b/k');
    const auth = input.headers.get('authorization');
    input.headers.set('authorization', auth.slice(0, -4) + 'dead');
    assert.equal((await verifySignature(input)).error, 'signature mismatch');
  });

  test('an unknown access key is rejected', async () => {
    const input = await signed('https://shard.example.org/b/k');
    input.lookupSecret = () => null;
    assert.equal((await verifySignature(input)).error, 'unknown access key');
  });

  test('an unsigned x-amz header is rejected', async () => {
    const input = await signed('https://shard.example.org/b/k');
    input.headers.set('x-amz-acl', 'public-read');
    assert.match((await verifySignature(input)).error, /unsigned x-amz header: x-amz-acl/);
  });

  test('a stale date is rejected', async () => {
    const input = await signed('https://shard.example.org/b/k');
    const result = await verifySignature({ ...input, now: Date.now() + 20 * 60 * 1000 });
    assert.equal(result.error, 'x-amz-date outside the window');
  });

  test('a body that does not match the declared hash is rejected', async () => {
    // aws4fetch declares UNSIGNED-PAYLOAD for s3 by default; a browser SDK
    // hashes string bodies, so the hash is set here to sign the same shape.
    const input = await signed('https://shard.example.org/b/k', {
      method: 'PUT',
      body: 'hello',
      headers: { 'x-amz-content-sha256': await sha256hex('hello') },
    });
    assert.equal((await verifySignature(input)).error, undefined);
    assert.equal(
      (await verifySignature({ ...input, body: Buffer.from('hellp') })).error,
      'body does not match x-amz-content-sha256',
    );
  });

  test('UNSIGNED-PAYLOAD is accepted and the body is not bound', async () => {
    const input = await signed('https://shard.example.org/b/k', { method: 'PUT', body: 'blob bytes' });
    assert.equal(input.headers.get('x-amz-content-sha256'), 'UNSIGNED-PAYLOAD');
    assert.equal((await verifySignature(input)).error, undefined);
  });

  test('a streaming payload hash is rejected', async () => {
    const input = await signed('https://shard.example.org/b/k', {
      method: 'PUT',
      body: 'x',
      headers: { 'x-amz-content-sha256': 'STREAMING-AWS4-HMAC-SHA256-PAYLOAD' },
    });
    assert.match((await verifySignature(input)).error, /^unsupported x-amz-content-sha256/);
  });

  test('a missing Authorization header is rejected', async () => {
    const input = await signed('https://shard.example.org/b/k');
    input.headers.delete('authorization');
    assert.equal((await verifySignature(input)).error, 'missing or unparseable Authorization header');
  });
});

describe('sigv4 presigned form', () => {
  const presign = async (url, expires) => {
    const u = new URL(url);
    u.searchParams.set('X-Amz-Expires', String(expires));
    const req = await aws.sign(u.toString(), { method: 'GET', aws: { signQuery: true } });
    return {
      method: 'GET', url: new URL(req.url), headers: new Headers(),
      lookupSecret: lookup, allowPresigned: true,
    };
  };

  test('the happy path verifies', async () => {
    const input = await presign('https://shard.example.org/t-sparcd/a/b.jpg', 900);
    const out = await verifySignature(input);
    assert.equal(out.error, undefined);
    assert.equal(out.accessKeyId, KEY.accessKeyId);
    assert.equal(out.presigned, true);
  });

  test('an over-long expiry is rejected', async () => {
    const input = await presign('https://shard.example.org/t-sparcd/a/b.jpg', 7200);
    assert.equal((await verifySignature(input)).error, 'X-Amz-Expires exceeds one hour');
  });

  test('an expired URL is rejected', async () => {
    const input = await presign('https://shard.example.org/t-sparcd/a/b.jpg', 60);
    const result = await verifySignature({ ...input, now: Date.now() + 120 * 1000 });
    assert.equal(result.error, 'presigned URL has expired');
  });

  test('presigned is off unless opted in', async () => {
    const input = await presign('https://shard.example.org/t-sparcd/a/b.jpg', 900);
    const result = await verifySignature({ ...input, allowPresigned: false });
    assert.equal(result.error, 'missing or unparseable Authorization header');
  });

  test('a tampered path is rejected', async () => {
    const input = await presign('https://shard.example.org/t-sparcd/a/b.jpg', 900);
    input.url = new URL(input.url.toString().replace('/a/b.jpg', '/a/c.jpg'));
    assert.equal((await verifySignature(input)).error, 'signature mismatch');
  });
});

describe('canonical query string', () => {
  test('duplicate values sort after the key', () => {
    const url = new URL('https://h/p?partNumber=2&partNumber=1&a=z');
    assert.equal(canonicalQueryString(url), 'a=z&partNumber=1&partNumber=2');
  });
  test('the presign signature parameter is omitted', () => {
    const url = new URL('https://h/p?X-Amz-Signature=abc&b=1');
    assert.equal(canonicalQueryString(url, 'X-Amz-Signature'), 'b=1');
  });
  test("!'()* are percent-encoded", () => {
    assert.equal(encodeRfc3986("a!'()*b"), 'a%21%27%28%29%2Ab');
  });
});

describe('namespace (invariant 1)', () => {
  const ns = makeNamespace({ namespace: 't-', allow: 'sparcd,sparcd-*' });

  test('an allowed bucket maps forward and back', () => {
    assert.equal(ns.toUpstream('sparcd-abc'), 't-sparcd-abc');
    assert.equal(ns.toClient('t-sparcd-abc'), 'sparcd-abc');
    assert.equal(ns.toUpstream('sparcd'), 't-sparcd');
  });

  test('a bucket outside the allow list has no mapping', () => {
    assert.equal(ns.toUpstream('canary'), null);
    assert.equal(ns.toUpstream('t-canary'), null);
  });

  test('an upstream bucket without the namespace has no client name', () => {
    assert.equal(ns.toClient('sparcd-abc'), null);
    assert.equal(ns.toClient('canary-outside'), null);
    assert.equal(ns.toClient('t-canary-outside'), null);
  });

  test('a client bucket that already carries the namespace is not the namespaced one', () => {
    // `t-sparcd-abc` is a legal client name only if it maps to `t-t-sparcd-abc`,
    // which is a different bucket from the upstream `t-sparcd-abc`.
    assert.equal(ns.toUpstream('t-sparcd-abc'), null);
  });

  test('crafted bucket segments are rejected', () => {
    for (const path of [
      '/../etc/passwd', '/sparcd%2F..%2Fcanary/k', '/SPARCD-ABC/k', '//k', '/sp/k',
      '/sparcd..abc/k', '/sparcd-/k', '/-sparcd/k',
    ]) {
      const bucket = bucketFromPath(path);
      assert.equal(bucket === null || ns.toUpstream(bucket) === null, true, path);
    }
  });

  test('an empty namespace still gates on the allow list', () => {
    const plain = makeNamespace({ namespace: '', allow: 'sparcd,sparcd-*' });
    assert.equal(plain.toUpstream('sparcd-abc'), 'sparcd-abc');
    assert.equal(plain.toUpstream('other'), null);
    assert.equal(plain.toClient('other'), null);
  });

  test('keys keep their slashes and decode per segment', () => {
    assert.equal(keyFromPath('/b/Collections/u/Uploads/a%20b/c.jpg'), 'Collections/u/Uploads/a b/c.jpg');
    assert.equal(keyFromPath('/b'), '');
  });

  test('ListBuckets is rebuilt from approved names only', () => {
    const xml = '<ListAllMyBucketsResult><Buckets>'
      + '<Bucket><Name>t-sparcd-settings-test</Name><CreationDate>x</CreationDate></Bucket>'
      + '<Bucket><Name>t-sparcd-aaa</Name><CreationDate>x</CreationDate></Bucket>'
      + '<Bucket><Name>canary-outside</Name><CreationDate>x</CreationDate></Bucket>'
      + '</Buckets></ListAllMyBucketsResult>';
    const visible = parseBucketNames(xml)
      .map((n) => ns.toClient(n))
      .filter((c) => c !== null && c !== 'sparcd-aaa');
    const out = buildListBuckets(visible);
    assert.match(out, /<Name>sparcd-settings-test<\/Name>/);
    assert.equal(out.includes('canary'), false);
    assert.equal(out.includes('sparcd-aaa'), false);
    assert.equal(out.includes('t-sparcd'), false);
  });

  test('an echoed bucket name is rewritten', () => {
    const xml = '<ListBucketResult><Name>t-sparcd-aaa</Name><Contents><Key>t-sparcd-aaa</Key></Contents></ListBucketResult>';
    const out = rewriteBucketName(xml, 't-sparcd-aaa', 'sparcd-aaa');
    assert.match(out, /<Name>sparcd-aaa<\/Name>/);
    // A key that happens to equal the bucket name is not a bucket name.
    assert.match(out, /<Key>t-sparcd-aaa<\/Key>/);
  });
});

describe('classify', () => {
  const q = (s) => new URLSearchParams(s);
  const call = (method, bucket, key, query = '', headers = new Headers()) =>
    classify({ method, bucket, key, query: q(query), headers });

  test('the operations we serve', () => {
    assert.equal(call('GET', null, '', ''), 'ListBuckets');
    assert.equal(call('GET', 'b', '', 'list-type=2&prefix=Settings/'), 'ListObjectsV2');
    assert.equal(call('GET', 'b', '', 'location='), 'GetBucketLocation');
    assert.equal(call('HEAD', 'b', ''), 'HeadBucket');
    assert.equal(call('GET', 'b', 'k'), 'GetObject');
    assert.equal(call('HEAD', 'b', 'k'), 'HeadObject');
    assert.equal(call('PUT', 'b', 'k'), 'PutObject');
    assert.equal(call('POST', 'b', 'k', 'uploads='), 'CreateMultipartUpload');
    assert.equal(call('PUT', 'b', 'k', 'uploadId=x&partNumber=1'), 'UploadPart');
    assert.equal(call('POST', 'b', 'k', 'uploadId=x'), 'CompleteMultipartUpload');
    assert.equal(call('DELETE', 'b', 'k', 'uploadId=x'), 'AbortMultipartUpload');
    assert.equal(call('GET', 'b', 'k', 'uploadId=x'), 'ListParts');
    assert.equal(call('DELETE', 'b', 'k'), 'DeleteObject');
  });

  test('the operations we do not', () => {
    for (const query of ['acl=', 'policy=', 'versioning=', 'tagging=', 'cors=', 'versions=']) {
      assert.equal(call('GET', 'b', '', query), null, query);
      assert.equal(call('PUT', 'b', 'k', query), null, query);
    }
    assert.equal(call('PUT', 'b', ''), null, 'CreateBucket');
    assert.equal(call('DELETE', 'b', ''), null, 'DeleteBucket');
    assert.equal(call('POST', 'b', '', 'delete='), null, 'DeleteObjects');
    assert.equal(
      call('PUT', 'b', 'k', '', new Headers({ 'x-amz-copy-source': '/other/k' })),
      null, 'CopyObject',
    );
  });
});

describe('the access table', () => {
  const uuid = '8dbd9c43-5c3d-411d-8778-617d4693c69b';
  const base = `Collections/${uuid}`;
  const admin = { status: 'active', admin: true, id: 'a' };
  const person = (level) => ({ status: 'active', admin: false, id: 'p', level });
  const at = (op, key, level, who = person(level)) =>
    decide(who, { op, key, isSettings: false, uuid, level });

  const media = `${base}/Uploads/2026.01.01.00.00.00_jo/img/a.jpg`;
  const taggerCsv = `${base}/Uploads/2026.01.01.00.00.00_jo/observations.csv`;
  const taggerSnap = `${base}/Uploads/s/.sparcd-tagger-snapshots/jo%40x.edu/2026-01-01T00-00-00/manifest.json`;
  const deployments = `${base}/Uploads/2026.01.01.00.00.00_jo/deployments.csv`;
  const collectionDoc = `${base}/collection.json`;

  test('look reads but never writes', () => {
    assert.equal(at('GetObject', media, 'look').allow, true);
    assert.equal(at('ListObjectsV2', '', 'look').allow, true);
    assert.equal(at('HeadBucket', '', 'look').allow, true);
    assert.equal(at('GetBucketLocation', '', 'look').allow, true);
    for (const op of ['PutObject', 'DeleteObject', 'CreateMultipartUpload', 'UploadPart']) {
      assert.equal(at(op, media, 'look').allow, false, op);
    }
  });

  test('identify writes only what the Tagger writes', () => {
    assert.equal(at('PutObject', taggerCsv, 'identify').allow, true);
    assert.equal(at('PutObject', taggerSnap, 'identify').allow, true);
    assert.equal(at('PutObject', deployments, 'identify').allow, true);
    assert.equal(at('PutObject', media, 'identify').allow, false);
    assert.equal(at('CreateMultipartUpload', media, 'identify').allow, false);
    assert.equal(at('DeleteObject', media, 'identify').allow, false);
  });

  test('identify writes deployments.csv at the upload and in a snapshot, and nowhere else', () => {
    const upload = `${base}/Uploads/2026.01.01.00.00.00_jo`;
    const snap = `${upload}/.sparcd-tagger-snapshots/jo%40x.edu/2026-01-01T00-00-00`;
    assert.equal(at('PutObject', `${upload}/deployments.csv`, 'identify').allow, true);
    assert.equal(at('PutObject', `${snap}/deployments.csv`, 'identify').allow, true);
    for (const key of [
      `${upload}/deployments.csv.bak`,
      `${upload}/xdeployments.csv`,
      `${upload}/Deployments.csv`,
      `${upload}/sub/deployments.csv`,
      `${snap}/sub/deployments.csv`,
      `${base}/Uploads/deployments.csv`,
      `${base}/deployments.csv`,
      `Collections/00000000-0000-0000-0000-000000000000/Uploads/2026.01.01.00.00.00_jo/deployments.csv`,
      'Settings/deployments.csv',
      `Settings/${upload}/deployments.csv`,
    ]) assert.equal(at('PutObject', key, 'identify').allow, false, key);
    assert.equal(
      decide(person('identify'), { op: 'PutObject', key: 'Settings/deployments.csv', isSettings: true, uuid, level: 'identify' }).allow,
      false, 'settings bucket',
    );
  });

  test('the rule itself refuses dot segments for every Tagger file', () => {
    const upload = `${base}/Uploads/2026.01.01.00.00.00_jo`;
    for (const leaf of ['deployments.csv', 'media.csv', 'observations.csv', 'UploadMeta.json']) {
      for (const key of [
        `${base}/Uploads/../${leaf}`,
        `${base}/Uploads/./${leaf}`,
        `${upload}/.sparcd-tagger-snapshots/../2026-01-01T00-00-00/${leaf}`,
        `${upload}/.sparcd-tagger-snapshots/jo/../${leaf}`,
        `${upload}/.sparcd-tagger-snapshots/./2026-01-01T00-00-00/${leaf}`,
        `${upload}/.sparcd-tagger-snapshots/jo/./${leaf}`,
      ]) {
        assert.equal(taggerWriteKey(key, uuid), false, key);
        assert.equal(at('PutObject', key, 'identify').allow, false, key);
      }
    }
    // Dots inside a name are ordinary.
    assert.equal(taggerWriteKey(`${base}/Uploads/..jo/observations.csv`, uuid), true);
    assert.equal(taggerWriteKey(`${upload}/.sparcd-tagger-snapshots/j.o/2026.01/manifest.json`, uuid), true);
  });

  test('a traversal onto deployments.csv never reaches the rule', () => {
    // The server refuses these by key shape before decide() runs, decoding
    // each path segment first, so an escaped slash cannot smuggle one in.
    for (const path of [
      `${base}/Uploads/../deployments.csv`,
      `${base}/Uploads/./deployments.csv`,
      `${base}/Uploads/2026.01.01.00.00.00_jo/../../deployments.csv`,
      `${base}/Uploads/..%2F2026.01.01.00.00.00_jo/deployments.csv`,
      `${base}/Uploads/%2E%2E/deployments.csv`,
      `${base}/Uploads/2026.01.01.00.00.00_jo%5C..%5Cdeployments.csv`,
    ]) {
      const key = keyFromPath(`/bucket/${path}`);
      assert.equal(safeKeySegments(key), false, path);
    }
  });

  test('upload adds media and multipart under Uploads/', () => {
    assert.equal(at('PutObject', media, 'upload').allow, true);
    assert.equal(at('PutObject', deployments, 'upload').allow, true);
    for (const op of ['CreateMultipartUpload', 'UploadPart', 'CompleteMultipartUpload',
      'AbortMultipartUpload', 'ListParts']) {
      assert.equal(at(op, media, 'upload').allow, true, op);
    }
    assert.equal(at('PutObject', `${base}/species.json`, 'upload').allow, false);
    assert.equal(at('DeleteObject', media, 'upload').allow, false);
    assert.equal(at('PutObject', `${base}/notes/x.txt`, 'upload').allow, false);
  });

  test('run adds delete and the three collection documents', () => {
    assert.equal(at('DeleteObject', media, 'run').allow, true);
    for (const doc of ['collection.json', 'species.json', 'locations.json']) {
      assert.equal(at('PutObject', `${base}/${doc}`, 'run').allow, true, doc);
    }
    assert.equal(at('DeleteObject', collectionDoc, 'run').allow, false);
    assert.equal(at('PutObject', `${base}/other.json`, 'run').allow, false);
  });

  test('no membership is a deny, and so is a non-active person', () => {
    assert.equal(at('GetObject', media, null).allow, false);
    assert.equal(decide({ status: 'paused', admin: true }, { op: 'GetObject', key: media }).allow, false);
    assert.equal(decide({ status: 'invited', admin: false }, { op: 'GetObject', key: media }).allow, false);
  });

  test('an unclassifiable request is a deny even for an admin', () => {
    assert.equal(decide(admin, { op: null, key: media }).allow, false);
  });

  test('invariant 4: the access tree is off limits to everyone', () => {
    const s = (op, key, who) => decide(who, { op, key, isSettings: true });
    for (const who of [admin, person('run')]) {
      assert.equal(s('GetObject', 'Settings/access/people/x.json', who).allow, false);
      assert.equal(s('PutObject', 'Settings/access/generation.json', who).allow, false);
      assert.equal(s('PutObject', 'Settings/activity/2026-01-01/x.ndjson', who).allow, false);
      assert.equal(s('DeleteObject', 'Settings/access/people/x.json', who).allow, false);
    }
    assert.equal(s('GetObject', 'Settings/activity/2026-01-01/x.ndjson', admin).allow, true);
    assert.equal(s('GetObject', 'Settings/activity/2026-01-01/x.ndjson', person('run')).allow, false);
    assert.equal(
      decide(admin, { op: 'PutObject', key: `${base}/members.json`, isSettings: false, uuid }).allow,
      false,
    );
    assert.equal(
      decide(admin, { op: 'GetObject', key: `${base}/members.json`, isSettings: false, uuid }).allow,
      true,
    );
  });

  test('the settings bucket is readable under Settings/ by anyone active', () => {
    const who = person('look');
    assert.equal(decide(who, { op: 'GetObject', key: 'Settings/locations.json', isSettings: true }).allow, true);
    assert.equal(decide(who, { op: 'GetObject', key: 'elsewhere.json', isSettings: true }).allow, false);
    assert.equal(decide(who, { op: 'PutObject', key: 'Settings/locations.json', isSettings: true }).allow, false);
  });
});

describe('key patterns', () => {
  const uuid = 'u-1';
  test('the Tagger trio and its snapshots, and nothing else', () => {
    assert.equal(taggerWriteKey(`Collections/${uuid}/Uploads/s/media.csv`, uuid), true);
    assert.equal(taggerWriteKey(`Collections/${uuid}/Uploads/s/UploadMeta.json`, uuid), true);
    assert.equal(taggerWriteKey(`Collections/${uuid}/Uploads/s/.sparcd-uploader-snapshots/u/t/media.csv`, uuid), false);
    assert.equal(taggerWriteKey(`Collections/other/Uploads/s/media.csv`, uuid), false);
    assert.equal(taggerWriteKey(`Collections/${uuid}/Uploads/s/sub/media.csv`, uuid), false);
  });
  test('Uploads/ needs at least one segment past the prefix', () => {
    assert.equal(uploadsKey(`Collections/${uuid}/Uploads/`, uuid), false);
    assert.equal(uploadsKey(`Collections/${uuid}/Uploads/a/b/c.jpg`, uuid), true);
    assert.equal(uploadsKey(`Collections/${uuid}/UploadsOther/a`, uuid), false);
  });
  test('the run documents are exactly three', () => {
    assert.equal(runDocumentKey(`Collections/${uuid}/species.json`, uuid), true);
    assert.equal(runDocumentKey(`Collections/${uuid}/members.json`, uuid), false);
  });
});

describe('activity shaping', () => {
  test('a media GET is a download, its metadata is not', () => {
    assert.equal(eventKind('GetObject', { isSettings: false, key: 'Collections/u/Uploads/s/a.jpg' }), 'download');
    assert.equal(eventKind('GetObject', { isSettings: false, key: 'Collections/u/Uploads/s/media.csv' }), null);
    assert.equal(eventKind('ListObjectsV2', { isSettings: false, key: '' }), null);
    assert.equal(eventKind('HeadObject', { isSettings: false, key: 'Collections/u/Uploads/s/a.jpg' }), null);
  });
  test('writes split into identify, upload and list-change', () => {
    assert.equal(eventKind('PutObject', { isSettings: false, key: 'Collections/u/Uploads/s/media.csv' }), 'identify');
    assert.equal(eventKind('PutObject', { isSettings: false, key: 'Collections/u/Uploads/s/a.jpg' }), 'upload');
    assert.equal(eventKind('PutObject', { isSettings: true, key: 'Settings/locations.json' }), 'list-change');
    assert.equal(eventKind('DeleteObject', { isSettings: false, key: 'Collections/u/Uploads/s/a.jpg' }), 'collection-change');
  });
});

describe('credential wrapping and invites', () => {
  const master = Buffer.alloc(32, 7).toString('base64');

  test('a wrapped secret round-trips and is shaped v1.iv.ct', async () => {
    const key = await loadMasterKey(master);
    const wrapped = await wrapSecret(key, 'super-secret');
    assert.match(wrapped, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.equal(await unwrapSecret(key, wrapped), 'super-secret');
  });

  test('another master key cannot unwrap it', async () => {
    const wrapped = await wrapSecret(await loadMasterKey(master), 's');
    const other = await loadMasterKey(Buffer.alloc(32, 8).toString('base64'));
    await assert.rejects(() => unwrapSecret(other, wrapped));
  });

  test('a tampered ciphertext fails the tag', async () => {
    const key = await loadMasterKey(master);
    const wrapped = await wrapSecret(key, 'super-secret');
    const [v, iv, ct] = wrapped.split('.');
    const flipped = `${v}.${iv}.${ct.slice(0, -2)}${ct.slice(-2) === 'AA' ? 'AB' : 'AA'}`;
    await assert.rejects(() => unwrapSecret(key, flipped));
  });

  test('a short master key is refused', () => {
    assert.throws(() => loadMasterKey(Buffer.alloc(16).toString('base64')));
  });

  test('access key ids are SPK plus 17 base32 characters', () => {
    for (let i = 0; i < 50; i += 1) assert.match(newAccessKeyId(), /^SPK[A-Z2-7]{17}$/);
    assert.equal(newSecretKey().length, 40);
  });

  test('an invite matches once, and never after it expires', () => {
    const { token, record } = newInvite();
    assert.equal(inviteMatches(record, token), true);
    assert.equal(inviteMatches(record, `${token}x`), false);
    assert.equal(inviteMatches(undefined, token), false);
    const expired = { tokenHash: hashToken(token), expiresAt: new Date(Date.now() - 1).toISOString() };
    assert.equal(inviteMatches(expired, token), false);
  });
});

describe('upstream signing', () => {
  // Ceph RGW refuses a PUT whose content-type is not inside SignedHeaders, so
  // the proxy signs everything it sends. No socket: global fetch is replaced
  // with a recorder, and aws4fetch hands it the signed Request.
  async function capture(run) {
    const real = globalThis.fetch;
    let seen;
    globalThis.fetch = async (req) => {
      seen = req;
      return new Response('', { status: 200, headers: { etag: '"x"' } });
    };
    try {
      await run(makeUpstream({
        endpoint: 'https://rgw.example/',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'b'.repeat(40),
      }));
    } finally {
      globalThis.fetch = real;
    }
    const auth = seen.headers.get('authorization');
    return {
      request: seen,
      signedHeaders: /SignedHeaders=([^,]+)/.exec(auth)[1].split(';'),
    };
  }

  test('a metadata PUT signs its content-type and its guard', async () => {
    const { signedHeaders } = await capture((upstream) => upstream.put(
      'sparcd-settings', 'people/p1.json', '{"id":"p1"}',
      { ifNoneMatch: '*' },
    ));
    assert.ok(signedHeaders.includes('content-type'));
    assert.ok(signedHeaders.includes('if-none-match'));
    assert.ok(!signedHeaders.includes('content-length'));
  });

  test('the proxied passthrough signs the headers it forwards', async () => {
    // The header set `proxyFetch` in server.mjs hands to `upstream.send`.
    const headers = new Headers({
      'content-type': 'image/jpeg',
      'if-none-match': '*',
      'x-amz-meta-sha256': 'deadbeef',
    });
    const { request, signedHeaders } = await capture((upstream) => upstream.send(
      upstream.url('sparcd-coll', 'Media/abc/img.jpg'),
      { method: 'PUT', headers, body: Buffer.from([0xff, 0xd8]) },
    ));
    assert.equal(request.method, 'PUT');
    for (const name of ['content-type', 'host', 'if-none-match', 'x-amz-meta-sha256']) {
      assert.ok(signedHeaders.includes(name), `${name} is not signed`);
    }
  });

  test('a metadata PUT sends its If-Match unquoted', async () => {
    const { request } = await capture((upstream) => upstream.put(
      'sparcd-settings', 'people/p1.json', '{"id":"p1"}',
      { ifMatch: '"c1f2"' },
    ));
    assert.equal(request.headers.get('if-match'), 'c1f2');
  });
});

describe('If-Match normalizing', () => {
  const cases = [
    ['"c1f2"', 'c1f2'],
    ['c1f2', 'c1f2'],
    ['W/"c1f2"', 'c1f2'],
    ['"a", "b"', 'a, b'],
    ['"a",W/"b", c', 'a, b, c'],
    ['*', '*'],
    ['', ''],
    ['  ', ''],
    ['"a", , "b"', 'a, b'],
    ['""', ''],
    ['"a"b"', 'a"b'],
  ];
  for (const [input, want] of cases) {
    test(`${JSON.stringify(input)} → ${JSON.stringify(want)}`, () => {
      assert.equal(normalizeIfMatch(input), want);
    });
  }

  test('null and undefined pass through', () => {
    assert.equal(normalizeIfMatch(null), null);
    assert.equal(normalizeIfMatch(undefined), undefined);
  });
});

describe('a reload against slow storage', () => {
  /** Counts how many reads are in the air at once, and answers on a later turn. */
  function slowUpstream(people) {
    let live = 0;
    const peak = { reads: 0 };
    const later = async (value) => {
      live += 1;
      peak.reads = Math.max(peak.reads, live);
      await new Promise((resolve) => setTimeout(resolve, 1));
      live -= 1;
      return value;
    };
    return {
      peak,
      listBuckets: () => later(['sparcd-settings-slow']),
      listKeys: (_bucket, prefix) => later(
        prefix === PEOPLE_PREFIX ? people.map((p) => `${PEOPLE_PREFIX}${p.id}.json`) : [],
      ),
      getJson: (_bucket, key) => later(key === GENERATION_KEY
        ? { status: 200, value: { generation: 1 }, etag: 'g' }
        : { status: 200, value: people.find((p) => key.endsWith(`${p.id}.json`)), etag: 'e' }),
    };
  }

  test('reads every person at once, not one after another', async () => {
    const people = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `Person ${i}`, keys: [] }));
    const upstream = slowUpstream(people);
    const store = makeStore({ upstream, namespace: '', allow: 'sparcd,sparcd-*' });
    await store.reload();
    assert.equal(store.people().length, 5);
    assert.ok(upstream.peak.reads >= 5, `only ${upstream.peak.reads} read in the air at once`);
  });
});
