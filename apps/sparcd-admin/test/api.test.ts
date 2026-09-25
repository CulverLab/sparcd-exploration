import { describe, expect, it } from 'vitest'
import { ApiError, createApi, identify, join, NoAccessServiceError, problemSentence } from '../src/api'
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

describe('what to say when it fails', () => {
  it('has one sentence per code', () => {
    expect(problemSentence(new ApiError(409, 'last_runner', 'x'))).toBe('A collection always needs at least one person running it.')
    expect(problemSentence(new ApiError(409, 'last_admin', 'x'))).toBe("SPARC'd always needs at least one administrator.")
    expect(problemSentence(new ApiError(412, 'changed_elsewhere', 'x'))).toBe('Someone else changed this. Reload and try again.')
    expect(problemSentence(new ApiError(503, 'busy', 'x'))).toBe('The storage is not answering right now. Try again in a minute.')
    expect(problemSentence(new ApiError(502, 'upstream', 'x'))).toBe('The storage is not answering right now. Try again in a minute.')
  })

  it('falls back to one generic sentence, never the raw message', () => {
    for (const code of ['invalid', 'forbidden', 'not_found', 'too_large', 'anything-new']) {
      expect(problemSentence(new ApiError(400, code, 'Internal: SPK4 rejected by rules.js:214'))).toBe(
        "That didn't work. Try again, and ask for help if it keeps happening.",
      )
    }
    expect(problemSentence(new NoAccessServiceError())).toBe('This storage does not manage people.')
    expect(problemSentence(Error('boom'))).not.toContain('boom')
  })
})

describe('member writes carry the version', () => {
  const seen: RequestInit[] = []
  const api = createApi(config, (async (_url: string, init: RequestInit) => {
    seen.push(init)
    return jsonResponse({ members: [], membersVersion: 'members-v2' })
  }) as unknown as typeof fetch)

  it('sends If-Match when a member list already exists', async () => {
    seen.length = 0
    const result = await api.setMembers('sparcd-aaa', [], 'members-v1')
    expect((seen[0].headers as Record<string, string>)['if-match']).toBe('members-v1')
    expect(result.membersVersion).toBe('members-v2')
  })

  it('sends If-None-Match when there is no member list yet', async () => {
    seen.length = 0
    await api.setMembers('sparcd-aaa', [], null)
    const headers = seen[0].headers as Record<string, string>
    expect(headers['if-none-match']).toBe('*')
    expect(headers['if-match']).toBeUndefined()
    expect(headers.authorization).toContain('SignedHeaders=')
  })

  it('puts and deletes one person at a time', async () => {
    seen.length = 0
    await api.setMember('sparcd-aaa', 'p1', { access: 'upload', exactLocations: true })
    expect(seen[0].method).toBe('PUT')
    expect(JSON.parse(seen[0].body as string)).toEqual({ access: 'upload', exactLocations: true })
    await api.removeMember('sparcd-aaa', 'p1')
    expect(seen[1].method).toBe('DELETE')
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
