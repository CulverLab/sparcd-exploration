// The security review's findings, at the level each one lives at. Socket-free.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  makeNamespace, parseBucketNames, buildListBuckets, leaksNamespace, scrubErrorDetail,
  safeKeySegments, safeRequestTarget,
} from '../namespace.mjs';
import {
  listingGuard, buildListing, afterTree, decodeListingToken,
} from '../rules.mjs';
import { peekAccessKeyId, verifySignature } from '../sigv4.mjs';
import { makeActivity, KINDS } from '../activity.mjs';
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

// ---------------------------------------------------------------------------
// Round 3: the follow-ups from reviewing the rewrite.
// ---------------------------------------------------------------------------

describe('N3: responses are scrubbed by shape, not by tag name', () => {
  test('Location and Endpoint go the way Resource and HostId did', () => {
    const xml = '<CompleteMultipartUploadResult>'
      + '<Location>http://upstream.internal:9000/t-sparcd-aaa/k.jpg</Location>'
      + '<Endpoint>upstream.internal:9000</Endpoint>'
      + '<Bucket>t-sparcd-aaa</Bucket><Key>k.jpg</Key><ETag>"e"</ETag>'
      + '</CompleteMultipartUploadResult>';
    const out = scrubErrorDetail(xml);
    assert.equal(out.includes('Location'), false);
    assert.equal(out.includes('Endpoint'), false);
    assert.equal(out.includes('upstream.internal'), false);
    assert.match(out, /<Key>k\.jpg<\/Key>/);
  });

  test('a namespaced name anywhere but a Key or a Prefix is a leak', () => {
    assert.equal(leaksNamespace('<Message>bucket t-sparcd-aaa is missing</Message>', 't-'), true);
    assert.equal(leaksNamespace('<Location>http://h/t-sparcd-aaa/k</Location>', 't-'), true);
    assert.equal(leaksNamespace('<Endpoint>t-sparcd-aaa.h</Endpoint>', 't-'), true);
    // Object keys and listing prefixes are the caller's own strings.
    assert.equal(leaksNamespace('<Key>t-notes/x.txt</Key>', 't-'), false);
    assert.equal(leaksNamespace('<Prefix>t-notes/</Prefix>', 't-'), false);
    // A namespace that appears mid-word is not a bucket name.
    assert.equal(leaksNamespace('<Message>the widget-t-shirt failed</Message>', 't-'), false);
  });
});

describe('N4: a settings listing steps around the protected trees', () => {
  test('the jump target sorts after everything in the tree', () => {
    const after = afterTree('Settings/access/');
    assert.ok(after > 'Settings/access/zzzzzzzz');
    assert.ok(after > 'Settings/access/￿');
    assert.ok(after < 'Settings/activity/');
    assert.ok(after < 'Settings/locations.json');
  });

  test('a page that had to stop says so, with a token of our own', () => {
    const xml = buildListing({
      bucket: 'b',
      prefix: 'Settings/',
      keys: [{ key: 'Settings/a.json' }, { key: 'Settings/b.json' }],
      commonPrefixes: [],
      truncated: true,
      nextToken: 'Settings/b.json',
    });
    assert.match(xml, /<IsTruncated>true<\/IsTruncated>/);
    const token = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1];
    assert.ok(token, 'no continuation token');
    assert.equal(token.includes('Settings/'), false, 'the token is not opaque');
    assert.equal(decodeListingToken(token), 'Settings/b.json');
  });

  test('an untruncated page still carries no token', () => {
    const xml = buildListing({ bucket: 'b', keys: [], commonPrefixes: [] });
    assert.match(xml, /<IsTruncated>false<\/IsTruncated>/);
    assert.equal(xml.includes('NextContinuationToken'), false);
  });

  test('a token that is not ours reads as no token at all', () => {
    assert.equal(decodeListingToken('not base64url !!!'), null);
    assert.equal(decodeListingToken(''), null);
  });
});

describe('N5: the Host is the one the signature is checked against', () => {
  test('a backslash in the target is refused before parsing', () => {
    // `new URL('/\\evil.example/x', 'http://good')` yields host `evil.example`,
    // so the check has to happen on the raw bytes.
    assert.equal(safeRequestTarget('/\\evil.example/x'), false);
    assert.equal(safeRequestTarget('/b/k?a=\\'), false);
    assert.equal(safeRequestTarget('//evil.example/x'), false);
    assert.equal(safeRequestTarget('http://evil.example/x'), false);
    assert.equal(safeRequestTarget('/b/Collections/u/Uploads/s/a.jpg?x-id=PutObject'), true);
    assert.equal(safeRequestTarget('/'), true);
  });
});

describe('N7: the activity writer does one flush at a time', () => {
  test('recording during a stuck flush does not start a second one', async () => {
    let inFlight = 0;
    let peak = 0;
    let failing = true;
    const written = [];
    const client = () => ({
      put: async (bucket, key, body) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        if (failing) return false;
        written.push(body);
        return true;
      },
    });
    const activity = makeActivity({
      upstream: client, settingsBucket: () => 'b', flushMs: 1,
    });
    for (let i = 0; i < 400; i += 1) {
      activity.record({ personId: `p${i}`, kind: 'download', bucket: 'x', status: 200 });
    }
    await activity.drain();
    assert.equal(peak, 1, `${peak} flushes overlapped`);

    failing = false;
    await activity.drain();
    const lines = written.flatMap((b) => b.trim().split('\n'));
    assert.equal(lines.length, 400, `kept ${lines.length} of 400`);
  });

  test('a source that stops misbehaving is forgotten', async () => {
    const activity = makeActivity({
      upstream: () => ({ put: async () => true }), settingsBucket: () => 'b', flushMs: 1,
    });
    activity.badSignature('10.0.0.9', { detail: 'x' });
    assert.equal(activity.trackedSources(), 1);
    activity.sweep(Date.now() + 120000);
    assert.equal(activity.trackedSources(), 0);
  });
});

describe('N8: reloads are serialized and never go backwards', () => {
  const slowStore = () => {
    let running = 0;
    let peak = 0;
    let runs = 0;
    const upstream = {
      listBuckets: async () => {
        running += 1;
        peak = Math.max(peak, running);
        runs += 1;
        await new Promise((r) => setTimeout(r, 10));
        running -= 1;
        return ['t-sparcd-settings-x'];
      },
      getJson: async () => ({ status: 404 }),
      get: async () => ({ status: 404 }),
      listKeys: async () => [],
      listCommonPrefixes: async () => [],
      put: async () => true,
    };
    return {
      store: makeStore({ upstream, namespace: 't-', allow: 'sparcd,sparcd-*' }),
      peak: () => peak,
      runs: () => runs,
    };
  };

  test('five callers at once become one reload and one follow-up', async () => {
    const { store, peak, runs } = slowStore();
    await Promise.all([
      store.reload(), store.reload(), store.reload(), store.reload(), store.reload(),
    ]);
    assert.equal(peak(), 1, `${peak()} reloads overlapped`);
    assert.equal(runs(), 2, `${runs()} reloads ran, expected one plus one follow-up`);
  });

  test('a caller arriving mid-reload still sees the result of its own request', async () => {
    const { store } = slowStore();
    const first = store.reload();
    const second = store.reload();
    await Promise.all([first, second]);
    assert.equal(store.snapshot().settingsBucket, 'sparcd-settings-x');
  });
});

// ---------------------------------------------------------------------------
// Round 4: what the admin screens actually ask for.
// ---------------------------------------------------------------------------

describe('activity queries the admin screens make', () => {
  const EVENTS = [
    { ts: '2026-01-01T00:00:01.000Z', kind: 'download', bucket: 'b', key: 'Collections/u/Uploads/s/IMG_0412.JPG' },
    { ts: '2026-01-01T00:00:02.000Z', kind: 'download', bucket: 'b', key: 'Collections/u/Uploads/t/IMG_0412.JPG' },
    { ts: '2026-01-01T00:00:03.000Z', kind: 'download', bucket: 'b', key: 'Collections/u/Uploads/s/img_0412.jpg' },
    { ts: '2026-01-01T00:00:04.000Z', kind: 'denied', bucket: 'b' },
    { ts: '2026-01-01T00:00:05.000Z', kind: 'bad-signature', bucket: 'b' },
    { ts: '2026-01-01T00:00:06.000Z', kind: 'list-change', bucket: 'b' },
    { ts: '2026-01-01T00:00:07.000Z', kind: 'collection-change', bucket: 'b' },
    { ts: '2026-01-01T00:00:08.000Z', kind: 'upload', bucket: 'b' },
  ];
  const canned = () => makeActivity({
    settingsBucket: () => 'b',
    upstream: () => ({
      put: async () => true,
      listCommonPrefixes: async () => ['Settings/activity/2026-01-01/'],
      listKeys: async () => ['Settings/activity/2026-01-01/1-00000000.ndjson'],
      get: async () => ({
        status: 200, text: `${EVENTS.map((e) => JSON.stringify(e)).join('\n')}\n`,
      }),
    }),
  });

  test('a single kind still filters to that kind', async () => {
    const { events } = await canned().query({ kinds: ['denied'] });
    assert.deepEqual(events.map((e) => e.kind), ['denied']);
  });

  test('several kinds come back together, newest first', async () => {
    const { events } = await canned().query({ kinds: ['denied', 'bad-signature'] });
    assert.deepEqual(events.map((e) => e.kind), ['bad-signature', 'denied']);
    const changes = await canned().query({ kinds: ['list-change', 'collection-change'] });
    assert.deepEqual(changes.events.map((e) => e.kind), ['collection-change', 'list-change']);
  });

  test('no kinds at all is every kind', async () => {
    const { events } = await canned().query({});
    assert.equal(events.length, EVENTS.length);
  });

  test('the downloads query takes a file name as well as a whole key', async () => {
    const byName = await canned().downloads({ bucket: 'b', key: 'IMG_0412.JPG' });
    assert.deepEqual(byName.events.map((e) => e.key), [
      'Collections/u/Uploads/t/IMG_0412.JPG',
      'Collections/u/Uploads/s/IMG_0412.JPG',
    ]);

    const byKey = await canned().downloads({
      bucket: 'b', key: 'Collections/u/Uploads/s/IMG_0412.JPG',
    });
    assert.deepEqual(byKey.events.map((e) => e.key), ['Collections/u/Uploads/s/IMG_0412.JPG']);
  });

  test('the file-name match is case-sensitive', async () => {
    const { events } = await canned().downloads({ bucket: 'b', key: 'img_0412.jpg' });
    assert.deepEqual(events.map((e) => e.key), ['Collections/u/Uploads/s/img_0412.jpg']);
  });

  test('the kinds the contract names are the ones the API will take', () => {
    assert.deepEqual([...KINDS].sort(), [
      'access-change', 'bad-signature', 'collection-change', 'denied', 'download',
      'identify', 'list-change', 'log-gap', 'sign-in', 'upload',
    ]);
  });
});
