import { describe, expect, it } from 'vitest'
import { loadAdminData, probeWriteAccess } from '../src/load'
import { fakeStorage, httpError, settingsStore } from './storage'

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
