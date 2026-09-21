import { SignatureV4 } from '@smithy/signature-v4'
import type { S3Config } from '@sparcd/types'

export type Access = 'look' | 'identify' | 'upload' | 'run'
export type PersonStatus = 'invited' | 'active' | 'paused'

export type Membership = {
  bucket: string
  uuid?: string
  name?: string | null
  access: Access
  exactLocations: boolean
}

export type Person = {
  id: string
  name: string
  email: string
  status: PersonStatus
  admin: boolean
  lastActiveAt?: string | null
  collections: Membership[]
}

export type WhoAmI = {
  id: string
  name: string
  email: string
  admin: boolean
  collections: Membership[]
}

export type Invite = { token: string; expiresAt: string }

export type CollectionMember = {
  personId: string
  name?: string
  access: Access
  exactLocations: boolean
}

export type CollectionAccess = {
  bucket: string
  uuid: string
  name: string | null
  organization: string | null
  members: CollectionMember[]
}

export type ActivityKind =
  | 'download' | 'upload' | 'identify' | 'list-change' | 'collection-change'
  | 'access-change' | 'denied' | 'bad-signature' | 'sign-in'

export type ActivityEvent = {
  ts: string
  requestId?: string
  personId?: string
  personName?: string
  kind: ActivityKind
  bucket?: string
  key?: string
  status?: number
  bytes?: number
  detail?: Record<string, unknown>
}

export type ActivityQuery = {
  from?: string
  to?: string
  person?: string
  bucket?: string
  kind?: ActivityKind[]
  limit?: number
}

export type JoinResult = { endpoint: string; accessKey: string; secretKey: string; name: string }

/** The storage answered, but not as the access service — plain S3, no people. */
export class NoAccessServiceError extends Error {
  constructor() {
    super('This storage does not manage people.')
    this.name = 'NoAccessServiceError'
  }
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

// WebCrypto stands in for the SDK's hash class so the signer needs nothing
// beyond @smithy/signature-v4 itself.
class Sha256 {
  private parts: Uint8Array[] = []
  constructor(private readonly secret?: unknown) {}
  update(data: Uint8Array | string) {
    this.parts.push(typeof data === 'string' ? new TextEncoder().encode(data) : data)
  }
  async digest(): Promise<Uint8Array> {
    const total = this.parts.reduce((sum, part) => sum + part.length, 0)
    const joined = new Uint8Array(total)
    let at = 0
    for (const part of this.parts) {
      joined.set(part, at)
      at += part.length
    }
    if (this.secret === undefined) return new Uint8Array(await crypto.subtle.digest('SHA-256', joined))
    const raw = typeof this.secret === 'string' ? new TextEncoder().encode(this.secret) : (this.secret as Uint8Array)
    const key = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, joined))
  }
}

export function endpointUrl(config: S3Config) {
  if (/^https?:\/\//i.test(config.endpoint)) return config.endpoint.replace(/\/$/, '')
  return `${config.secure === false ? 'http' : 'https'}://${config.endpoint}`
}

type Request = { method: string; path: string; query?: Record<string, string>; body?: unknown }

async function readJson(response: Response) {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('json')) throw new NoAccessServiceError()
  return response.json()
}

async function fail(response: Response): Promise<never> {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('json')) throw new NoAccessServiceError()
  const body = await response.json().catch(() => null)
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error
  throw new ApiError(response.status, error?.code ?? 'error', error?.message ?? `Request failed (${response.status}).`)
}

export function createApi(config: S3Config, doFetch: typeof fetch = fetch) {
  const base = endpointUrl(config)
  const signer = new SignatureV4({
    service: 's3',
    region: config.region,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    sha256: Sha256 as never,
  })

  const send = async ({ method, path, query, body }: Request) => {
    const url = new URL(`${base}/-/${path}`)
    for (const [name, value] of Object.entries(query ?? {})) url.searchParams.set(name, value)
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const signed = await signer.sign({
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: { host: url.host, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
      body: payload,
    })
    let response: Response
    try {
      response = await doFetch(url.toString(), { method, headers: signed.headers as Record<string, string>, body: payload })
    } catch {
      // No response at all: wrong endpoint, no service, or CORS refusing the
      // preflight. Indistinguishable from plain S3 from here.
      throw new NoAccessServiceError()
    }
    if (!response.ok) return fail(response)
    return readJson(response)
  }

  const activityQuery = (query: ActivityQuery) => {
    const params: Record<string, string> = {}
    if (query.from) params.from = query.from
    if (query.to) params.to = query.to
    if (query.person) params.person = query.person
    if (query.bucket) params.bucket = query.bucket
    if (query.kind?.length) params.kind = query.kind.join(',')
    if (query.limit) params.limit = String(query.limit)
    return params
  }

  return {
    async whoami(): Promise<WhoAmI> {
      return (await send({ method: 'GET', path: 'whoami' })) as WhoAmI
    },
    async listPeople(): Promise<Person[]> {
      return ((await send({ method: 'GET', path: 'admin/people' })) as { people: Person[] }).people
    },
    async addPerson(input: { name: string; email: string; admin?: boolean; memberships?: { bucket: string; access: Access; exactLocations?: boolean }[] }) {
      return (await send({ method: 'POST', path: 'admin/people', body: input })) as { person: Person; invite: Invite }
    },
    async updatePerson(id: string, patch: { name?: string; email?: string; admin?: boolean; status?: 'active' | 'paused' }) {
      return ((await send({ method: 'PATCH', path: `admin/people/${encodeURIComponent(id)}`, body: patch })) as { person: Person }).person
    },
    async resetPerson(id: string) {
      return ((await send({ method: 'POST', path: `admin/people/${encodeURIComponent(id)}/reset`, body: {} })) as { invite: Invite }).invite
    },
    async listCollectionAccess(): Promise<CollectionAccess[]> {
      return ((await send({ method: 'GET', path: 'admin/collections' })) as { collections: CollectionAccess[] }).collections
    },
    async setMembers(bucket: string, members: { personId: string; access: Access; exactLocations: boolean }[]) {
      return ((await send({
        method: 'PUT',
        path: `admin/collections/${encodeURIComponent(bucket)}/members`,
        body: { members },
      })) as { members: CollectionMember[] }).members
    },
    async activity(query: ActivityQuery) {
      return (await send({ method: 'GET', path: 'admin/activity', query: activityQuery(query) })) as {
        events: ActivityEvent[]
        truncated?: boolean
      }
    },
    async downloadsOf(bucket: string, key: string) {
      return ((await send({ method: 'GET', path: 'admin/activity/downloads', query: { bucket, key } })) as { events: ActivityEvent[] }).events
    },
  }
}

export type AccessApi = ReturnType<typeof createApi>

/** The whoami answer, or null when this storage has no access service at all. */
export async function identify(api: Pick<AccessApi, 'whoami'>): Promise<WhoAmI | null> {
  try {
    return await api.whoami()
  } catch (cause) {
    if (cause instanceof NoAccessServiceError) return null
    if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) return null
    throw cause
  }
}

/** Join needs no signature: the token is the only thing that identifies anyone. */
export async function join(endpoint: string, token: string, doFetch: typeof fetch = fetch): Promise<JoinResult> {
  const base = /^https?:\/\//i.test(endpoint) ? endpoint.replace(/\/$/, '') : `https://${endpoint}`
  const response = await doFetch(`${base}/-/join`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token }),
  })
  if (!response.ok) return fail(response)
  return (await readJson(response)) as JoinResult
}
