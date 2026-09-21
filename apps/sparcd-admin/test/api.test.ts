import { describe, expect, it } from 'vitest'
import { createApi, identify, join, NoAccessServiceError } from '../src/api'
import { config } from './storage'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('signing', () => {
  it('signs each call with the logged-in connection', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const api = createApi(config, (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return jsonResponse({ id: 'p1', name: 'Jorge', email: 'j@x.org', admin: true, collections: [] })
    }) as unknown as typeof fetch)
    const me = await api.whoami()
    expect(me.name).toBe('Jorge')
    expect(seen!.url).toBe('https://storage.test/-/whoami')
    const headers = seen!.init.headers as Record<string, string>
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=ACCESSKEY\/\d{8}\/us-east-1\/s3\/aws4_request, SignedHeaders=[^,]+, Signature=[0-9a-f]{64}$/)
    expect(headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/)
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
  })
})

describe('the capability check', () => {
  it('reads plain S3 XML as no access service', async () => {
    const api = createApi(config, (async () => new Response('<Error/>', { status: 403, headers: { 'content-type': 'application/xml' } })) as unknown as typeof fetch)
    await expect(api.whoami()).rejects.toBeInstanceOf(NoAccessServiceError)
    expect(await identify(api)).toBeNull()
  })

  it('reads a network failure as no access service', async () => {
    const api = createApi(config, (async () => { throw Error('network') }) as unknown as typeof fetch)
    expect(await identify(api)).toBeNull()
  })

  it('passes a non-admin answer through', async () => {
    const api = createApi(config, (async () => jsonResponse({ id: 'p2', name: 'Ana', email: 'a@x.org', admin: false, collections: [] })) as unknown as typeof fetch)
    expect((await identify(api))?.admin).toBe(false)
  })
})

describe('joining', () => {
  it('sends the token unsigned and returns the connection', async () => {
    let body = ''
    const result = await join('storage.test', 'tok', (async (_url: string, init: RequestInit) => {
      body = init.body as string
      expect((init.headers as Record<string, string>).authorization).toBeUndefined()
      return jsonResponse({ endpoint: 'https://storage.test', accessKey: 'SPK1', secretKey: 's', name: 'Ana' })
    }) as unknown as typeof fetch)
    expect(JSON.parse(body)).toEqual({ token: 'tok' })
    expect(result.name).toBe('Ana')
  })

  it('reports a used link as a 404', async () => {
    await expect(join('storage.test', 'tok', (async () =>
      jsonResponse({ error: { code: 'not_found', message: 'gone' } }, 404)) as unknown as typeof fetch),
    ).rejects.toMatchObject({ status: 404 })
  })
})
