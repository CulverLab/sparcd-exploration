// The guard that decides whether this run may touch the storage it was
// pointed at. No browser, no sockets — it is a pure decision, and the one
// place a mistake would be expensive.

import { test, expect } from '@playwright/test'
// @ts-expect-error — plain JavaScript, shared with the stack.
import { planTarget, isLoopback, TargetRefused } from '../target.mjs'

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

  test('the real upstream hosts are not loopback', () => {
    for (const host of ['js2.jetstream-cloud.org', 'wildcats.sparcd.arizona.edu', 'https://127.0.0.1.example.org']) {
      expect(isLoopback(host)).toBe(false)
    }
  })
})
