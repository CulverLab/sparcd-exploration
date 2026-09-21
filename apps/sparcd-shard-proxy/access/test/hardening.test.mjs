// The security review's findings, at the level each one lives at. Socket-free.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeNamespace, parseBucketNames, buildListBuckets, leaksNamespace, scrubErrorDetail,
  safeKeySegments,
} from '../namespace.mjs';
import { listingGuard, buildListing } from '../rules.mjs';
import { peekAccessKeyId, verifySignature } from '../sigv4.mjs';
import { makeActivity } from '../activity.mjs';
import { makeStore } from '../store.mjs';
import { ERROR_CODES } from '../api.mjs';

const ns = makeNamespace({ namespace: 't-', allow: 'sparcd,sparcd-*' });

describe('finding 1: the service root is built, never filtered', () => {
  test('bucket names are parsed out of a real ListAllMyBucketsResult', () => {
    const xml = '<?xml version="1.0"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
      + '<Owner><ID>upstream-owner</ID><DisplayName>upstream</DisplayName></Owner><Buckets>'
      + '<Bucket><Name>t-sparcd-aaa</Name><CreationDate>2026-01-01T00:00:00.000Z</CreationDate></Bucket>'
      + '<Bucket xmlns="urn:x"><Name>canary-outside</Name><CreationDate>x</CreationDate></Bucket>'
      + '</Buckets></ListAllMyBucketsResult>';
    assert.deepEqual(parseBucketNames(xml), ['t-sparcd-aaa', 'canary-outside']);
  });

  test('a body that is not a bucket listing is unparseable, not empty', () => {
    assert.equal(parseBucketNames('{"buckets":["canary-outside"]}'), null);
    assert.equal(parseBucketNames('<Error><Code>AccessDenied</Code></Error>'), null);
    assert.equal(parseBucketNames(''), null);
  });

  test('the response is built from approved names with a placeholder owner', () => {
    const xml = buildListBuckets(['sparcd-aaa', 'sparcd-settings-test']);
    assert.match(xml, /<Name>sparcd-aaa<\/Name>/);
    assert.match(xml, /<Name>sparcd-settings-test<\/Name>/);
    assert.equal(xml.includes('upstream-owner'), false);
    assert.equal(xml.includes('canary'), false);
    assert.equal(xml.includes('t-sparcd'), false);
    assert.match(xml, /<Owner><ID>sparcd<\/ID><DisplayName>sparcd<\/DisplayName><\/Owner>/);
    // Exactly as many Bucket blocks as names given, whatever the upstream had.
    assert.equal([...xml.matchAll(/<Bucket>/g)].length, 2);
  });

  test('an upstream name surviving in a response is a leak', () => {
    assert.equal(leaksNamespace('<Name>t-sparcd-aaa</Name>', 't-'), true);
    assert.equal(leaksNamespace('<Bucket>t-sparcd-aaa</Bucket>', 't-'), true);
    assert.equal(leaksNamespace('<Resource>/t-sparcd-aaa/k</Resource>', 't-'), true);
    assert.equal(leaksNamespace('<Name>sparcd-aaa</Name>', 't-'), false);
    // A key that happens to start with the namespace is not a bucket name.
    assert.equal(leaksNamespace('<Key>t-notes/x.txt</Key>', 't-'), false);
    assert.equal(leaksNamespace('<Name>anything</Name>', ''), false);
  });

  test('Resource and HostId are dropped from an error body', () => {
    const xml = '<Error><Code>NoSuchKey</Code><Message>m</Message>'
      + '<Resource>/t-sparcd-aaa/k</Resource><HostId>abc123</HostId>'
      + '<RequestId>r</RequestId></Error>';
    const out = scrubErrorDetail(xml);
    assert.equal(out.includes('Resource'), false);
    assert.equal(out.includes('HostId'), false);
    assert.equal(out.includes('abc123'), false);
    assert.match(out, /<Code>NoSuchKey<\/Code>/);
  });
});

describe('finding 12: object keys', () => {
  test('traversal, backslashes, NUL and leading slashes are refused', () => {
    for (const key of [
      'Collections/u/../../etc', 'Collections/u/./x', 'a\\b', 'a\u0000b', '/leading',
      '..', '.',
    ]) assert.equal(safeKeySegments(key), false, key);
  });
  test('ordinary keys, including UTF-8 and spaces, are fine', () => {
    for (const key of [
      'Collections/u/Uploads/s/a.jpg', 'Collections/u/Uploads/s/sub dir/ñ.jpg',
      'Settings/locations.json', '',
      'Collections/u/Uploads/s/.sparcd-tagger-snapshots/a%40b/t/manifest.json',
    ]) assert.equal(safeKeySegments(key), true, key);
  });
});

describe('finding 7: settings-bucket listings', () => {
  const member = { admin: false, status: 'active' };
  const admin = { admin: true, status: 'active' };
  const guard = (prefix, person, isSettings = true) =>
    listingGuard({ prefix, person, isSettings });

  test('a prefix inside a protected tree is refused', () => {
    assert.equal(guard('Settings/access/', member).allow, false);
    assert.equal(guard('Settings/access/people/', admin).allow, false);
    assert.equal(guard('Settings/activity/2026-01-01/', member).allow, false);
    assert.equal(guard('Settings/activity/2026-01-01/', admin).allow, true);
  });

  test('a prefix that can only ever match a protected tree is refused', () => {
    assert.equal(guard('Settings/acc', member).allow, false);
    assert.equal(guard('Settings/activ', member).allow, false);
    assert.equal(guard('Settings/activ', admin).allow, true);
  });

  test('a prefix that straddles is allowed and filtered instead', () => {
    assert.equal(guard('Settings/', member).allow, true);
    assert.equal(guard('', member).allow, true);
    assert.equal(guard('Settings/locations', member).allow, true);
  });

  test('a collection bucket is not gated this way', () => {
    assert.equal(guard('Settings/access/', member, false).allow, true);
  });

  test('a built listing is one complete page with no continuation', () => {
    const xml = buildListing({
      bucket: 'sparcd-settings-test',
      prefix: 'Settings/',
      delimiter: '/',
      keys: [{ key: 'Settings/locations.json', size: 12, lastModified: '2026-01-01T00:00:00.000Z', etag: '"e"' }],
      commonPrefixes: ['Settings/species/'],
    });
    assert.match(xml, /<IsTruncated>false<\/IsTruncated>/);
    assert.equal(xml.includes('NextContinuationToken'), false);
    assert.equal(xml.includes('NextMarker'), false);
    assert.match(xml, /<KeyCount>1<\/KeyCount>/);
    assert.match(xml, /<Name>sparcd-settings-test<\/Name>/);
    assert.match(xml, /<Key>Settings\/locations\.json<\/Key>/);
    assert.match(xml, /<Prefix>Settings\/species\/<\/Prefix>/);
  });
});

describe('finding 3: the key is resolved before the body is read', () => {
  test('the access key id is readable from the header form alone', () => {
    const headers = new Headers({
      authorization: 'AWS4-HMAC-SHA256 Credential=SPKABC/20260101/us-east-1/s3/aws4_request, '
        + 'SignedHeaders=host, Signature=ff',
    });
    assert.equal(peekAccessKeyId({ headers, url: new URL('http://h/b/k') }), 'SPKABC');
  });

  test('and from the presigned form alone', () => {
    const url = new URL('http://h/b/k?X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + '&X-Amz-Credential=SPKXYZ%2F20260101%2Fus-east-1%2Fs3%2Faws4_request');
    assert.equal(peekAccessKeyId({ headers: new Headers(), url }), 'SPKXYZ');
  });

  test('nothing to peek at is null, not a throw', () => {
    assert.equal(peekAccessKeyId({ headers: new Headers(), url: new URL('http://h/') }), null);
    assert.equal(
      peekAccessKeyId({ headers: new Headers({ authorization: 'Basic abc' }), url: new URL('http://h/') }),
      null,
    );
  });
});

describe('finding 8: presigned URLs are read-only', () => {
  test('a presigned PUT is refused before anything else', async () => {
    const url = new URL('http://h/b/k?X-Amz-Algorithm=AWS4-HMAC-SHA256'
      + '&X-Amz-Credential=SPKXYZ%2F20260101%2Fus-east-1%2Fs3%2Faws4_request'
      + '&X-Amz-Date=20260101T000000Z&X-Amz-Expires=900&X-Amz-SignedHeaders=host&X-Amz-Signature=ff');
    for (const method of ['PUT', 'POST', 'DELETE']) {
      const out = await verifySignature({
        method, url, headers: new Headers(), lookupSecret: () => 'x', allowPresigned: true,
      });
      assert.equal(out.error, 'presigned URLs are read-only', method);
    }
  });
});

describe('finding 13: the activity writer under back-pressure', () => {
  const stubUpstream = (behaviour) => {
    const written = [];
    return {
      written,
      client: () => ({
        put: async (bucket, key, body) => {
          if (behaviour.failing) return false;
          written.push({ key, body });
          return true;
        },
      }),
    };
  };

  test('a failed flush is re-queued, not lost', async () => {
    const behaviour = { failing: true };
    const stub = stubUpstream(behaviour);
    const activity = makeActivity({
      upstream: stub.client, settingsBucket: () => 'b', flushMs: 5,
    });
    activity.record({ personId: 'p', kind: 'download', bucket: 'x', status: 200 });
    await activity.drain();
    assert.equal(stub.written.length, 0);

    behaviour.failing = false;
    await activity.drain();
    assert.equal(stub.written.length, 1);
    assert.match(stub.written[0].body, /"kind":"download"/);
  });

  test('past the queue cap the oldest go and a log-gap says how many', async () => {
    const behaviour = { failing: true };
    const stub = stubUpstream(behaviour);
    const activity = makeActivity({
      upstream: stub.client, settingsBucket: () => 'b', flushMs: 5, maxQueue: 10,
    });
    for (let i = 0; i < 25; i += 1) {
      activity.record({ personId: `p${i}`, kind: 'download', bucket: 'x', status: 200 });
    }
    await activity.drain();

    behaviour.failing = false;
    await activity.drain();
    const lines = stub.written.flatMap((w) => w.body.trim().split('\n')).map(JSON.parse);
    assert.ok(lines.length <= 11, `kept ${lines.length}`);
    const gap = lines.find((l) => l.kind === 'log-gap');
    assert.ok(gap, 'no log-gap event');
    assert.ok(gap.detail.dropped >= 14, `dropped ${gap.detail?.dropped}`);
    // The newest survived; the oldest are the ones that went.
    assert.equal(lines.some((l) => l.personId === 'p24'), true);
    assert.equal(lines.some((l) => l.personId === 'p0'), false);
  });

  test('bad signatures are one aggregated line per source per minute', async () => {
    const stub = stubUpstream({ failing: false });
    const activity = makeActivity({
      upstream: stub.client, settingsBucket: () => 'b', flushMs: 5,
    });
    for (let i = 0; i < 50; i += 1) activity.badSignature('10.0.0.1', { detail: 'signature mismatch' });
    for (let i = 0; i < 3; i += 1) activity.badSignature('10.0.0.2', { detail: 'unknown access key' });
    await activity.drain();
    const lines = stub.written.flatMap((w) => w.body.trim().split('\n')).map(JSON.parse);
    const bad = lines.filter((l) => l.kind === 'bad-signature');
    assert.equal(bad.length, 2, `got ${bad.length} lines`);
    assert.equal(bad.find((l) => l.ip === '10.0.0.1').detail.count, 50);
    assert.equal(bad.find((l) => l.ip === '10.0.0.2').detail.count, 3);
  });
});

describe('finding 5: a failed generation bump still applies locally', () => {
  // A store whose upstream writes the person fine but cannot bump the counter.
  const stubStore = () => {
    const objects = new Map();
    const upstream = {
      listBuckets: async () => ['t-sparcd-settings-x'],
      getJson: async (bucket, key) => {
        const hit = objects.get(`${bucket}/${key}`);
        return hit ? { status: 200, etag: hit.etag, value: JSON.parse(hit.body) } : { status: 404 };
      },
      get: async () => ({ status: 404 }),
      listKeys: async (bucket, prefix) =>
        [...objects.keys()]
          .filter((k) => k.startsWith(`${bucket}/${prefix}`))
          .map((k) => k.slice(bucket.length + 1)),
      put: async (bucket, key, body) => {
        if (key.endsWith('generation.json')) throw new Error('upstream is down for this one key');
        objects.set(`${bucket}/${key}`, { body, etag: `"${objects.size}"` });
        return true;
      },
    };
    return { store: makeStore({ upstream, namespace: 't-', allow: 'sparcd,sparcd-*' }) };
  };

  test('savePerson reloads even when the generation write throws', async () => {
    const { store } = stubStore();
    await store.reload();
    // The person write lands; only the counter bump fails. The change has to
    // be in force on this proxy anyway, which means the reload has to run.
    await assert.rejects(() => store.savePerson({
      id: 'p1', name: 'P', status: 'paused', admin: false, keys: [],
    }, 'new'));
    assert.equal(store.person('p1')?.status, 'paused', 'the pause did not take effect locally');
  });
});

describe('finding 6 and contract c: the published error codes', () => {
  test('the set is exactly the nine the contract names', () => {
    assert.deepEqual([...ERROR_CODES].sort(), [
      'busy', 'changed_elsewhere', 'forbidden', 'invalid', 'last_admin',
      'last_runner', 'not_found', 'too_large', 'upstream',
    ]);
  });
});
