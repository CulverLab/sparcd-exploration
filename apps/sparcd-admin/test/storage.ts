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

export function fakeStorage(store: Store, faults: Record<string, () => Error> = {}) {
  const log: string[] = []
  const allowlists: { read: string[]; write: string[] }[] = []

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
        body(bucket, key)
        return { size: 0, etag: `${key}-etag`, metadata: {} }
      },
      async getObject(bucket: string, key: string) {
        log.push(`get ${bucket}/${key}`)
        return new TextEncoder().encode(JSON.stringify(body(bucket, key)))
      },
      async writeImmutable(bucket: string, key: string, content: string) {
        log.push(`write ${bucket}/${key}`)
        store[bucket][key] = JSON.parse(content)
      },
      async replaceIfUnchanged(bucket: string, key: string, content: string) {
        log.push(`replace ${bucket}/${key}`)
        store[bucket][key] = JSON.parse(content)
        return { etag: `${key}-etag` }
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
