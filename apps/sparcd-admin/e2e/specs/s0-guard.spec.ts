// The guard that decides whether this run may touch the storage it was
// pointed at. No browser, no sockets — it is a pure decision, and the one
// place a mistake would be expensive.

import { test, expect } from '@playwright/test'
// @ts-expect-error — plain JavaScript, shared with the stack.
import { planTarget, isLoopback, TargetRefused } from '../target.mjs'
// @ts-expect-error — plain JavaScript, shared with the stack.
import { removeWritten } from '../cleanup.mjs'

test.describe('the upstream guard', () => {
  test('brings up its own MinIO when no upstream is named', () => {
    const plan = planTarget({})
    expect(plan.mode).toBe('local')
    expect(plan.startMinio).toBe(true)
    expect(plan.createBuckets).toBe(true)
    expect(plan.namespace).toBe('e2e-')
  })

  test('treats every loopback spelling as storage this run owns', () => {
    for (const upstream of ['http://127.0.0.1:9000', 'localhost:9000', 'http://[::1]:9000', 'http://127.0.0.7:9000']) {
      expect(isLoopback(upstream)).toBe(true)
      const plan = planTarget({ E2E_UPSTREAM: upstream })
      expect(plan.mode).toBe('local')
      expect(plan.startMinio).toBe(false)
      expect(plan.upstream).toBe(upstream)
    }
  })

  test('refuses a remote upstream without a namespace', () => {
    expect(() => planTarget({ E2E_UPSTREAM: 'https://storage.example.org', E2E_NAMESPACE: '' }))
      .toThrow(TargetRefused)
  })

  test("refuses a namespace that is the real buckets' own prefix", () => {
    expect(() => planTarget({ E2E_UPSTREAM: 'https://storage.example.org', E2E_NAMESPACE: 'sparcd-' }))
      .toThrow(/prefix real SPARC'd buckets carry/)
  })

  test('refuses to create buckets on storage it does not own', () => {
    expect(() => planTarget({
      E2E_UPSTREAM: 'https://storage.example.org',
      E2E_NAMESPACE: 'scratch-',
      E2E_CREATE_BUCKETS: '1',
    })).toThrow(/does not own its buckets/)
  })

  test('a contained remote run never starts MinIO and only removes its own objects', () => {
    const plan = planTarget({ E2E_UPSTREAM: 'https://storage.example.org', E2E_NAMESPACE: 'scratch-' })
    expect(plan.mode).toBe('remote')
    expect(plan.startMinio).toBe(false)
    expect(plan.createBuckets).toBe(false)
    expect(plan.deleteOwnObjectsOnly).toBe(true)
  })

  test('starts its own proxy and mints its own administrator by default', () => {
    const plan = planTarget({})
    expect(plan.proxy).toBe('internal')
    expect(plan.startProxy).toBe(true)
    expect(plan.admin).toBe(null)
  })

  test('starts no proxy when it is pointed at one already deployed', () => {
    const plan = planTarget({
      E2E_UPSTREAM: 'https://storage.example.org',
      E2E_NAMESPACE: 'scratch-',
      E2E_PROXY_URL: 'https://proxy.example.org:8460/',
      E2E_ADMIN_ACCESS_KEY_ID: 'AKIAEXAMPLE',
      E2E_ADMIN_SECRET_ACCESS_KEY: 'shhh',
    })
    expect(plan.proxy).toBe('external')
    expect(plan.startProxy).toBe(false)
    expect(plan.proxyUrl).toBe('https://proxy.example.org:8460')
    expect(plan.admin).toEqual({ accessKey: 'AKIAEXAMPLE', secretKey: 'shhh' })
    // Everything that keeps a remote run contained still holds.
    expect(plan.mode).toBe('remote')
    expect(plan.createBuckets).toBe(false)
    expect(plan.deleteOwnObjectsOnly).toBe(true)
  })

  test('refuses an external proxy without the administrator it cannot create there', () => {
    for (const admin of [
      {},
      { E2E_ADMIN_ACCESS_KEY_ID: 'AKIAEXAMPLE' },
      { E2E_ADMIN_SECRET_ACCESS_KEY: 'shhh' },
    ]) {
      expect(() => planTarget({ E2E_PROXY_URL: 'https://proxy.example.org:8460', ...admin }))
        .toThrow(/E2E_ADMIN_ACCESS_KEY_ID and E2E_ADMIN_SECRET_ACCESS_KEY/)
    }
  })

  test('cleanup removes what the run wrote and leaves everything else', async () => {
    const deleted: string[] = []
    let listed = 0
    const root = {
      url: (bucket: string, key: string) => `http://storage.test/${bucket}/${key}`,
      async send(url: string) { deleted.push(String(url)); return { ok: true, status: 204 } },
      async listKeys() { listed += 1; return ['scratch-sparcd-settings-test/Settings/theirs.json'] },
    }
    const written = [{ bucket: 'scratch-sparcd-settings-test', key: 'Settings/species.json' }]

    await removeWritten(root, written, { startProxy: true })

    expect(deleted).toEqual(['http://storage.test/scratch-sparcd-settings-test/Settings/species.json'])
    // A pre-existing key under the same prefix is never even asked about.
    expect(listed).toBe(0)
  })

  test("leaves an external proxy's own records where they are", async () => {
    const deleted: string[] = []
    const root = {
      url: (bucket: string, key: string) => `http://storage.test/${bucket}/${key}`,
      async send(url: string) { deleted.push(String(url)); return { ok: true, status: 204 } },
      async listKeys() { return [] },
    }
    const written = [
      { bucket: 'scratch-sparcd-settings-test', key: 'Settings/access/people/p1.json' },
      { bucket: 'scratch-sparcd-settings-test', key: 'Settings/species.json' },
    ]

    await removeWritten(root, written, { startProxy: false })

    expect(deleted).toEqual(['http://storage.test/scratch-sparcd-settings-test/Settings/species.json'])
  })

  test('the real upstream hosts are not loopback', () => {
    for (const host of ['js2.jetstream-cloud.org', 'wildcats.sparcd.arizona.edu', 'https://127.0.0.1.example.org']) {
      expect(isLoopback(host)).toBe(false)
    }
  })
})
