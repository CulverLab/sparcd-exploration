import { describe, expect, it } from 'vitest'
import { loadAdminData, probeWriteAccess } from '../src/load'
import { fakeStorage, httpError, settingsStore, type Store } from './storage'

describe('opening the workspace', () => {
  it('reads each shared list once and writes nothing (bug 9)', async () => {
    const storage = fakeStorage(settingsStore())
    const data = await loadAdminData(storage.make)
    expect(storage.count('get sparcd-settings-a/Settings/species.json')).toBe(1)
    expect(storage.count('get sparcd-settings-a/Settings/locations.json')).toBe(1)
    expect(storage.log.some((entry) => entry.startsWith('write '))).toBe(false)
    expect(data.collections).toHaveLength(1)
    expect(data.species.value).toEqual([{ name: 'Coyote', scientificName: 'Canis latrans' }])
  })

  it('narrows the working client to the areas it actually found (bug 10)', async () => {
    const storage = fakeStorage(settingsStore())
    await loadAdminData(storage.make)
    expect(storage.allowlists).toEqual([
      { read: ['sparcd', 'sparcd-*'], write: [] },
      { read: ['sparcd-settings-a', 'sparcd-abc'], write: ['sparcd-settings-a', 'sparcd-abc'] },
    ])
  })
})

describe('what went wrong (bug 11)', () => {
  it('says the login was refused instead of reporting nothing found', async () => {
    const storage = fakeStorage(settingsStore(), {
      'sparcd-settings-a/Settings/locations.json': () => httpError('SignatureDoesNotMatch', 403),
    })
    await expect(loadAdminData(storage.make)).rejects.toThrow('The login ID or secret was not accepted.')
  })

  it('surfaces a blocked read instead of reporting nothing found', async () => {
    const storage = fakeStorage(settingsStore(), {
      'sparcd-settings-a/Settings/locations.json': () => httpError('AccessDenied', 403),
    })
    await expect(loadAdminData(storage.make)).rejects.toThrow(/Access denied/)
  })

  it('passes over an area holding only one of the two lists (fix 5)', async () => {
    const store = settingsStore()
    store['sparcd-settings-0'] = { 'Settings/locations.json': [] }
    const storage = fakeStorage(store)
    const data = await loadAdminData(storage.make)
    expect(data.species.bucket).toBe('sparcd-settings-a')
  })

  it('says so plainly when the lists really are not there', async () => {
    const storage = fakeStorage({ 'sparcd-settings-a': {}, other: {} })
    await expect(loadAdminData(storage.make)).rejects.toThrow(
      'The shared species and location lists were not found in this storage.',
    )
  })

  it('does not read a failed collection list as "none used here"', async () => {
    const storage = fakeStorage(settingsStore(), {
      'sparcd-abc/Collections/abc/species.json': () => httpError('InternalError', 500),
    })
    await expect(loadAdminData(storage.make)).rejects.toThrow(/HTTP 500/)
  })

  it('treats a collection with nothing written yet as empty', async () => {
    const store = settingsStore()
    delete store['sparcd-abc']['Collections/abc/species.json']
    const storage = fakeStorage(store)
    const data = await loadAdminData(storage.make)
    expect(data.collections[0].speciesAssignment).toEqual({ values: [], etag: null })
  })
})

describe('the write check (bug 10)', () => {
  it('leaves a marker holding no part of the credentials', async () => {
    const store = settingsStore()
    const storage = fakeStorage(store)
    const client = storage.make(['sparcd-settings-a'], ['sparcd-settings-a'])
    await probeWriteAccess(client, 'sparcd-settings-a', 'Jorge Delgado')
    const written = Object.entries(store['sparcd-settings-a']).find(([key]) => key.startsWith('Settings/admin-sessions/'))!
    expect(JSON.stringify(written[1])).not.toContain('ACCESSKEY')
    expect(JSON.stringify(written[1])).not.toContain('SECRETKEY')
    expect(written[1]).toMatchObject({ schemaVersion: 1, actor: 'Jorge Delgado' })
  })
})

// Forty collections at three reads each is most of a login against real
// storage, so they are read a few at a time — without the answers arriving in
// a different order than the list they came from, or a different failure.
describe('reading many collections', () => {
  const manyStore = (count: number) => {
    const store = settingsStore()
    delete store['sparcd-abc']
    for (let index = 0; index < count; index += 1) {
      const uuid = `c${String(count - index).padStart(2, '0')}`
      store[`sparcd-${uuid}`] = {
        [`Collections/${uuid}/collection.json`]: { nameProperty: `Collection ${index}`, organizationProperty: 'Lab', descriptionProperty: 'Study' },
        [`Collections/${uuid}/species.json`]: [],
        [`Collections/${uuid}/locations.json`]: [],
      }
    }
    return store
  }

  /** Holds the first read of each collection so the test can count and order. */
  const heldCollections = (store: Store) => {
    const waiting: { bucket: string; resolve: () => void }[] = []
    const storage = fakeStorage(store, {}, (entry) => {
      const [method, at] = entry.split(' ')
      const bucket = at.split('/')[0]
      if (method !== 'stat' || !at.includes('/collection.json')) return undefined
      return new Promise<void>((resolve) => waiting.push({ bucket, resolve }))
    })
    return { storage, waiting }
  }

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  it('reads four at a time, no more', async () => {
    const { storage, waiting } = heldCollections(manyStore(10))
    const loading = loadAdminData(storage.make)
    await tick()
    expect(waiting).toHaveLength(4)
    while (waiting.length) {
      waiting.pop()!.resolve()
      await tick()
    }
    expect((await loading).collections).toHaveLength(10)
  })

  it('keeps the order of the list, not the order the answers came back in', async () => {
    const { storage, waiting } = heldCollections(manyStore(8))
    const loading = loadAdminData(storage.make)
    await tick()
    // Answer the newest waiting read first, so completion order is not list order.
    while (waiting.length) {
      waiting.pop()!.resolve()
      await tick()
    }
    const data = await loading
    const straight = fakeStorage(manyStore(8))
    expect(data.collections.map((one) => one.uuid)).toEqual((await loadAdminData(straight.make)).collections.map((one) => one.uuid))
    expect(data.collections.map((one) => one.name)).toEqual([...data.collections.map((one) => one.name)].sort())
  })

  it('reports the failure the first collection in the list hit', async () => {
    const store = manyStore(6)
    const storage = fakeStorage(store, {
      'sparcd-c02/Collections/c02/species.json': () => httpError('InternalError', 500),
      'sparcd-c05/Collections/c05/species.json': () => httpError('AccessDenied', 403),
    })
    // c05 is “Collection 1” and c02 is “Collection 4”: the earlier one wins.
    await expect(loadAdminData(storage.make)).rejects.toThrow(/Access denied/)
  })
})
