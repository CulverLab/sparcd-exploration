import { listCollections, translateReadError, type SafeS3Client } from '@sparcd/s3-safe'
import { settingsBucketCandidates } from './settingsBucket'
import { moment } from './moment'
import type { CollectionAssignment, CollectionRecord } from './CollectionEditor'

export const LOCATIONS_KEY = 'Settings/locations.json'
export const SPECIES_KEY = 'Settings/species.json'

// Which storage areas hold the lists is only knowable after looking, so
// discovery reads under the SPARC'd naming convention and nothing else. Once
// the real areas are known, the working client is pinned to exactly those.
const DISCOVERY_ALLOWLIST = ['sparcd', 'sparcd-*']

export type ClientFactory = (readAllowlist: string[], writeAllowlist: string[]) => SafeS3Client

export type SharedList = { key: string; value: unknown[]; etag: string; bucket: string }

export type AdminData = {
  /** When this read began, so an editor can tell it from its own later write. */
  startedAt: number
  client: SafeS3Client
  species: SharedList
  locations: SharedList
  collections: CollectionRecord[]
}

const decode = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes))

function isNotFound(cause: unknown) {
  const error = cause as { name?: string; $metadata?: { httpStatusCode?: number } }
  return error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound' || error.name === 'NoSuchKey'
}

/** A failure the administrator can act on, rather than "nothing was found". */
export function readProblem(cause: unknown, what: string): Error {
  const name = (cause as { name?: string }).name
  if (name === 'SignatureDoesNotMatch' || name === 'InvalidAccessKeyId')
    return Error('The login ID or secret was not accepted.')
  return translateReadError(cause, what)
}

async function findSettingsArea(client: SafeS3Client) {
  let visible: string[]
  try {
    visible = await client.listBuckets()
  } catch (cause) {
    throw readProblem(cause, 'the storage areas for this login')
  }
  for (const bucket of settingsBucketCandidates(visible)) {
    try {
      // Both files, or it is not the settings area: a half-populated candidate
      // would otherwise win and the other list would read as missing.
      await client.statObject(bucket, LOCATIONS_KEY)
      await client.statObject(bucket, SPECIES_KEY)
      return bucket
    } catch (cause) {
      if (!isNotFound(cause)) throw readProblem(cause, `the shared lists in “${bucket}”`)
    }
  }
  throw Error('The shared species and location lists were not found in this storage.')
}

// One collection is three reads, so a site with forty of them spends most of a
// login waiting. A few at a time keeps that short without burying the storage.
const COLLECTIONS_AT_ONCE = 4

/**
 * Runs `work` over `items` a few at a time. Results keep the order of `items`,
 * and the failure reported is the one the earliest item hit — the same error a
 * one-at-a-time read would have stopped on.
 */
export async function inParallel<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const done: R[] = new Array<R>(items.length)
  const failures: unknown[] = new Array<unknown>(items.length)
  let failed = false
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const at = next++
      try {
        done[at] = await work(items[at])
      } catch (cause) {
        failures[at] = cause
        failed = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  if (failed) throw failures.find((one) => one !== undefined)
  return done
}

export async function loadAdminData(makeClient: ClientFactory): Promise<AdminData> {
  const startedAt = moment()
  const discovery = makeClient(DISCOVERY_ALLOWLIST, [])
  const bucket = await findSettingsArea(discovery)
  const refs = await listCollections(discovery)
  const areas = [...new Set([bucket, ...refs.map((ref) => ref.bucket)])]
  const client = makeClient(areas, areas)

  const readShared = async (key: string): Promise<SharedList> => {
    try {
      const stat = await client.statObject(bucket, key)
      return { key, value: decode(await client.getObject(bucket, key)), etag: stat.etag!, bucket }
    } catch (cause) {
      throw readProblem(cause, key === SPECIES_KEY ? 'the shared species list' : 'the shared location list')
    }
  }

  const readCollection = async (collection: (typeof refs)[number]): Promise<CollectionRecord> => {
    const where = `“${collection.name ?? collection.bucket}”`
    const readAssignment = async (name: 'species' | 'locations'): Promise<CollectionAssignment> => {
      const assignmentKey = `Collections/${collection.uuid}/${name}.json`
      try {
        const stat = await client.statObject(collection.bucket, assignmentKey)
        const value = decode(await client.getObject(collection.bucket, assignmentKey))
        return { values: Array.isArray(value) ? value : [], etag: stat.etag ?? null }
      } catch (cause) {
        // Nothing written yet is the ordinary case for a young collection.
        // Anything else would otherwise read on screen as "none used here".
        if (!isNotFound(cause)) throw readProblem(cause, `the ${name} used in ${where}`)
        return { values: [], etag: null }
      }
    }
    const key = `Collections/${collection.uuid}/collection.json`
    let etag: string
    let document: Record<string, unknown>
    try {
      const stat = await client.statObject(collection.bucket, key)
      document = decode(await client.getObject(collection.bucket, key)) as Record<string, unknown>
      etag = stat.etag!
    } catch (cause) {
      throw readProblem(cause, `the collection ${where}`)
    }
    const [speciesAssignment, locationsAssignment] = await Promise.all([readAssignment('species'), readAssignment('locations')])
    return { ...collection, etag, document, speciesAssignment, locationsAssignment }
  }

  const collections = await inParallel(refs, COLLECTIONS_AT_ONCE, readCollection)
  return { startedAt, client, species: await readShared(SPECIES_KEY), locations: await readShared(LOCATIONS_KEY), collections }
}

/**
 * Confirm once per login that this key may write, by leaving a dated marker.
 * The marker is permanent, so it carries nothing but the time and who was at
 * the keyboard — never any part of the credentials used to write it.
 */
export async function probeWriteAccess(client: SafeS3Client, bucket: string, actor: string) {
  await client.writeImmutable(
    bucket,
    `Settings/admin-sessions/${crypto.randomUUID()}.json`,
    JSON.stringify({ schemaVersion: 1, openedAt: new Date().toISOString(), actor }, null, 2),
    { contentType: 'application/json' },
  )
}
