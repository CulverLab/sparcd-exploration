// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { ConditionalReplaceConflictError } from '@sparcd/s3-safe'
import { RegistryEditor, type Registry } from '../src/RegistryEditor'
import { button, click, field, hasButton, render, rowButtons, type } from './dom'
import { lastOf, methods, recordingClient } from './fake'

const species = (): Registry => ({
  key: 'Settings/species.json',
  bucket: 'sparcd-settings-a',
  etag: 'species-v1',
  value: [
    { name: 'Coyote', scientificName: 'Canis latrans' },
    { name: 'Coyote', scientificName: 'Canis latrans mearnsi' },
  ],
})

const locations = (): Registry => ({
  key: 'Settings/locations.json',
  bucket: 'sparcd-settings-a',
  etag: 'locations-v1',
  value: [{ nameProperty: 'Apache Pass', idProperty: 'DOS09', latProperty: 32.158, lngProperty: -109.4478, elevationProperty: 1415 }],
})

const saved = (calls: ReturnType<typeof recordingClient>['calls']) =>
  JSON.parse(lastOf(calls, 'replaceIfUnchanged').body!)

afterEach(() => { document.body.innerHTML = '' })

describe('picking a record (bug 1)', () => {
  it('edits the row that was clicked when two records carry the same name', async () => {
    const { calls, client } = recordingClient()
    const { host } = render(<RegistryEditor title="Species" registry={species()} client={client} actor="admin" reload={() => {}} />)
    await click(rowButtons(host)[1])
    await type(field(host, 'Common name'), 'Mearns coyote')
    await click(button(host, 'Save'))
    expect(saved(calls)).toEqual([
      { name: 'Coyote', scientificName: 'Canis latrans' },
      { name: 'Mearns coyote', scientificName: 'Canis latrans mearnsi' },
    ])
  })
})

describe('number boxes (bug 2)', () => {
  it('keeps what was typed, says what is wrong, and saves nothing', async () => {
    const { calls, client } = recordingClient()
    const { host } = render(<RegistryEditor title="Locations" registry={locations()} client={client} actor="admin" reload={() => {}} />)
    await click(rowButtons(host)[0])
    await type(field(host, 'Latitude'), '31.2q')
    expect(field(host, 'Latitude').value).toBe('31.2q')
    expect(host.textContent).toContain('Latitude must be a number, like 32.158.')
    await click(button(host, 'Save'))
    expect(calls).toEqual([])

    await type(field(host, 'Latitude'), ' ')
    await click(button(host, 'Save'))
    expect(host.textContent).toContain('Latitude needs a number.')
    expect(calls).toEqual([])

    await type(field(host, 'Latitude'), '91')
    await click(button(host, 'Save'))
    expect(host.textContent).toContain('Latitude must be between -90 and 90.')
    expect(calls).toEqual([])

    await type(field(host, 'Latitude'), '32.2')
    await click(button(host, 'Save'))
    expect(saved(calls)[0].latProperty).toBe(32.2)
  })
})

describe('retiring', () => {
  it('turns Retire into Bring back and keeps the row in the list', async () => {
    const { calls, client } = recordingClient()
    const { host } = render(<RegistryEditor title="Locations" registry={locations()} client={client} actor="admin" reload={() => {}} />)
    await click(rowButtons(host)[0])
    await click(button(host, 'Retire'))
    expect(host.textContent).toContain('Retired')
    expect(rowButtons(host)).toHaveLength(1)
    await click(button(host, 'Bring back'))
    await click(button(host, 'Save'))
    expect(saved(calls)[0].retired).toBe(false)
  })
})

describe('protected locations', () => {
  it('stores the plain checkbox as sensitive on the record', async () => {
    const { calls, client } = recordingClient()
    const { host } = render(<RegistryEditor title="Locations" registry={locations()} client={client} actor="admin" reload={() => {}} />)
    await click(rowButtons(host)[0])
    const box = Array.from(host.querySelectorAll('input[type="checkbox"]'))[0] as HTMLInputElement
    await click(box)
    expect(host.textContent).toContain('Hides exact coordinates from people without access.')
    await click(button(host, 'Save'))
    expect(saved(calls)[0].sensitive).toBe(true)
  })
})

describe('the save sequence', () => {
  it('writes the prepared note, then the list against the version it loaded, then the applied note', async () => {
    const { calls, client } = recordingClient()
    const { host } = render(<RegistryEditor title="Species" registry={species()} client={client} actor="admin" reload={() => {}} />)
    await click(rowButtons(host)[0])
    await type(field(host, 'Common name'), 'Coyote (plains)')
    await click(button(host, 'Save'))
    expect(methods(calls).map((one) => one.replace(/config\/[^/]+\/[^.]+/, 'config/<event>'))).toEqual([
      'writeImmutable Settings/audit/config/<event>.prepared.json',
      'replaceIfUnchanged Settings/species.json',
      'writeImmutable Settings/audit/config/<event>.applied.json',
    ])
    expect(calls[1].etag).toBe('species-v1')
    expect(host.textContent).toContain('Saved.')
  })

  it('says someone else changed it rather than overwriting them', async () => {
    const { client } = recordingClient({
      onReplace: (key) => { throw new ConditionalReplaceConflictError(key) },
    })
    const { host } = render(<RegistryEditor title="Species" registry={species()} client={client} actor="admin" reload={() => {}} />)
    await click(rowButtons(host)[0])
    await type(field(host, 'Common name'), 'Coyote (plains)')
    await click(button(host, 'Save'))
    expect(host.textContent).toContain('Someone else changed this list')
  })
})

describe('after a failed history entry', () => {
  it('saves again against the version just written (bug 7)', async () => {
    const { calls, client } = recordingClient({
      etags: ['species-v2'],
      onWrite: (key, attempt) => { if (key.endsWith('.applied.json') && attempt === 1) throw Error('storage hiccup') },
    })
    const { host } = render(<RegistryEditor title="Species" registry={species()} client={client} actor="admin" reload={() => {}} />)
    await click(rowButtons(host)[0])
    await type(field(host, 'Common name'), 'Coyote (plains)')
    await click(button(host, 'Save'))
    expect(host.textContent).toContain('Saved. Its history entry did not go through.')

    await type(field(host, 'Common name'), 'Coyote (desert)')
    await click(button(host, 'Save'))
    expect(lastOf(calls, 'replaceIfUnchanged').etag).toBe('species-v2')
  })

  it('reports a retry that fails again (bug 8)', async () => {
    const { client } = recordingClient({
      onWrite: (key) => { if (key.endsWith('.applied.json')) throw Error('storage hiccup') },
    })
    const { host } = render(<RegistryEditor title="Species" registry={species()} client={client} actor="admin" reload={() => {}} />)
    await click(rowButtons(host)[0])
    await type(field(host, 'Common name'), 'Coyote (plains)')
    await click(button(host, 'Save'))
    expect(hasButton(host, 'Retry history entry')).toBe(true)
    await click(button(host, 'Retry history entry'))
    expect(host.textContent).toContain('The history entry still did not go through: storage hiccup')
  })
})
