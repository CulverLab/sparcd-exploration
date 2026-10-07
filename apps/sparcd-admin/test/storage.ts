import type { SafeS3Client } from '@sparcd/s3-safe'
import type { S3Config } from '@sparcd/types'

export type Store = Record<string, Record<string, unknown>>

export const notFound = () => Object.assign(Error('NotFound'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } })
export const httpError = (name: string, httpStatusCode: number) =>
  Object.assign(Error(name), { name, $metadata: { httpStatusCode } })

export const config: S3Config = {
  endpoint: 'storage.test',
  region: 'us-east-1',
  accessKey: 'ACCESSKEY',
  secretKey: 'SECRETKEY',
  forcePathStyle: true,
  secure: true,
}

export function fakeStorage(
  store: Store,
  faults: Record<string, () => Error> = {},
  gate: (entry: string) => Promise<void> | void = () => {},
) {
  const log: string[] = []
  const allowlists: { read: string[]; write: string[] }[] = []
  const tags = new Map<string, string>()
  let version = 0
  const tagOf = (bucket: string, key: string) => {
    const at = `${bucket}/${key}`
    if (!tags.has(at)) tags.set(at, `${key}-etag`)
    return tags.get(at)!
  }

  const make = (read: string[], write: string[]) => {
    allowlists.push({ read, write })
    const fault = (bucket: string, key: string) => {
      const thrown = faults[`${bucket}/${key}`]
      if (thrown) throw thrown()
    }
    const body = (bucket: string, key: string) => {
      fault(bucket, key)
      const value = store[bucket]?.[key]
      if (value === undefined) throw notFound()
      return value
    }
    return {
      async listBuckets() {
        log.push('listBuckets')
        return Object.keys(store)
      },
      async statObject(bucket: string, key: string) {
        log.push(`stat ${bucket}/${key}`)
        await gate(`stat ${bucket}/${key}`)
        body(bucket, key)
        return { size: 0, etag: tagOf(bucket, key), metadata: {} }
      },
      async getObject(bucket: string, key: string) {
        log.push(`get ${bucket}/${key}`)
        await gate(`get ${bucket}/${key}`)
        return new TextEncoder().encode(JSON.stringify(body(bucket, key)))
      },
      async writeImmutable(bucket: string, key: string, content: string) {
        log.push(`write ${bucket}/${key}`)
        store[bucket][key] = JSON.parse(content)
      },
      async replaceIfUnchanged(bucket: string, key: string, content: string, opts: { etag: string }) {
        log.push(`replace ${bucket}/${key}`)
        if (tagOf(bucket, key) !== opts.etag) throw Error(`stale version tag for ${key}`)
        store[bucket][key] = JSON.parse(content)
        const next = `${key}-etag-${++version}`
        tags.set(`${bucket}/${key}`, next)
        return { etag: next }
      },
    } as unknown as SafeS3Client
  }

  return { log, allowlists, make, count: (entry: string) => log.filter((one) => one === entry).length }
}

export const settingsStore = (): Store => ({
  'sparcd-settings-a': {
    'Settings/locations.json': [{ idProperty: 'DOS09', nameProperty: 'Apache Pass', latProperty: 32.1, lngProperty: -109.4, elevationProperty: 1415 }],
    'Settings/species.json': [{ name: 'Coyote', scientificName: 'Canis latrans' }],
  },
  'sparcd-abc': {
    'Collections/abc/collection.json': { nameProperty: 'Educational Test', organizationProperty: 'Lab', descriptionProperty: 'Study' },
    'Collections/abc/species.json': [{ name: 'Coyote', scientificName: 'Canis latrans' }],
    'Collections/abc/locations.json': [{ idProperty: 'DOS09', nameProperty: 'Apache Pass' }],
  },
  other: {},
})
