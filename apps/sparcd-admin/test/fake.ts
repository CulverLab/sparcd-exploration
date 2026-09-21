import { ConditionalReplaceConflictError, PreconditionFailedError, type SafeS3Client } from '@sparcd/s3-safe'

export type Call = { method: string; bucket: string; key: string; body?: string; etag?: string }

export type FakeOptions = {
  /** Called before a write is attempted; throw to make that write fail. */
  onWrite?: (key: string, attempt: number) => void
  /** Called before a conditional replace is attempted; throw to make it fail. */
  onReplace?: (key: string, attempt: number) => void
  /** Keys that already exist, with the version tag the app was handed. */
  existing?: Record<string, string>
}

/**
 * Records every call a save makes, in order, and enforces the storage rules
 * the app leans on: an immutable write refuses an existing key, a conditional
 * replace refuses a stale version tag, and every write moves the tag on.
 */
export function recordingClient(options: FakeOptions = {}) {
  const calls: Call[] = []
  const tags = new Map(Object.entries(options.existing ?? {}))
  const attempts = new Map<string, number>()
  let version = 0
  const attempt = (key: string) => {
    const next = (attempts.get(key) ?? 0) + 1
    attempts.set(key, next)
    return next
  }
  const client = {
    async writeImmutable(bucket: string, key: string, body: string) {
      options.onWrite?.(key, attempt(`write:${key}`))
      if (tags.has(key)) throw new PreconditionFailedError(key)
      calls.push({ method: 'writeImmutable', bucket, key, body })
      tags.set(key, `v${++version}`)
    },
    async replaceIfUnchanged(bucket: string, key: string, body: string, opts: { etag: string }) {
      options.onReplace?.(key, attempt(`replace:${key}`))
      if (tags.get(key) !== opts.etag) throw new ConditionalReplaceConflictError(key)
      calls.push({ method: 'replaceIfUnchanged', bucket, key, body, etag: opts.etag })
      const next = `v${++version}`
      tags.set(key, next)
      return { etag: next }
    },
    async statObject(bucket: string, key: string) {
      calls.push({ method: 'statObject', bucket, key })
      return { size: 0, etag: tags.get(key), metadata: {} }
    },
  }
  return { calls, client: client as unknown as SafeS3Client, tagOf: (key: string) => tags.get(key) }
}

export const methods = (calls: Call[]) => calls.map((call) => `${call.method} ${call.key}`)
export const lastOf = (calls: Call[], method: string) => [...calls].reverse().find((call) => call.method === method)!
