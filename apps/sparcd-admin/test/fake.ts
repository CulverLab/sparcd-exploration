import type { SafeS3Client } from '@sparcd/s3-safe'

export type Call = { method: string; bucket: string; key: string; body?: string; etag?: string }

export type FakeOptions = {
  /** Called before a write is recorded; throw to make that write fail. */
  onWrite?: (key: string, attempt: number) => void
  /** Called before a conditional replace is recorded; throw to make it fail. */
  onReplace?: (key: string, attempt: number) => void
  /** ETags handed back by successive conditional replaces. */
  etags?: string[]
  statEtag?: string
}

/** Records every call a save makes, in order. */
export function recordingClient(options: FakeOptions = {}) {
  const calls: Call[] = []
  const attempts = new Map<string, number>()
  const attempt = (key: string) => {
    const next = (attempts.get(key) ?? 0) + 1
    attempts.set(key, next)
    return next
  }
  let replaced = 0
  const client = {
    async writeImmutable(bucket: string, key: string, body: string) {
      options.onWrite?.(key, attempt(`write:${key}`))
      calls.push({ method: 'writeImmutable', bucket, key, body })
    },
    async replaceIfUnchanged(bucket: string, key: string, body: string, opts: { etag: string }) {
      options.onReplace?.(key, attempt(`replace:${key}`))
      calls.push({ method: 'replaceIfUnchanged', bucket, key, body, etag: opts.etag })
      return { etag: options.etags?.[replaced++] ?? `v${replaced + 1}` }
    },
    async statObject(bucket: string, key: string) {
      calls.push({ method: 'statObject', bucket, key })
      return { size: 0, etag: options.statEtag ?? 'stat-etag', metadata: {} }
    },
  }
  return { calls, client: client as unknown as SafeS3Client }
}

export const methods = (calls: Call[]) => calls.map((call) => `${call.method} ${call.key}`)
export const lastOf = (calls: Call[], method: string) => [...calls].reverse().find((call) => call.method === method)!
