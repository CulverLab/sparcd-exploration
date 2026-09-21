// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { CollectionEditor, type CollectionRecord } from '../src/CollectionEditor'
import { button, click, field, hasButton, render, type } from './dom'
import { lastOf, recordingClient } from './fake'
import { moment } from '../src/moment'

const shared = {
  species: [
    { scientificName: 'Canis latrans', name: 'Coyote' },
    { scientificName: 'Puma concolor', name: 'Puma' },
    { scientificName: 'Lynx rufus', name: 'Bobcat' },
  ],
  locations: [{ idProperty: 'DOS09', nameProperty: 'Apache Pass' }],
}

const collection = (suffix: string, name: string): CollectionRecord => ({
  key: `sparcd-${suffix}::${suffix}`,
  bucket: `sparcd-${suffix}`,
  uuid: suffix,
  name,
  organization: `${name} Lab`,
  contact: null,
  description: 'Study',
  etag: `${suffix}-collection-etag`,
  document: { nameProperty: name, organizationProperty: `${name} Lab`, descriptionProperty: 'Study' },
  speciesAssignment: { values: [shared.species[0]], etag: `${suffix}-species-etag` },
  locationsAssignment: { values: [shared.locations[0]], etag: `${suffix}-locations-etag` },
})

const collections = [collection('aaa', 'Alpha'), collection('bbb', 'Beta')]

const stored = {
  'Collections/aaa/collection.json': 'aaa-collection-etag',
  'Collections/aaa/species.json': 'aaa-species-etag',
  'Collections/aaa/locations.json': 'aaa-locations-etag',
  'Collections/bbb/collection.json': 'bbb-collection-etag',
  'Collections/bbb/species.json': 'bbb-species-etag',
  'Collections/bbb/locations.json': 'bbb-locations-etag',
}

const element = (client: ReturnType<typeof recordingClient>['client'], records: CollectionRecord[]) => (
    <CollectionEditor
      loadedAt={moment()}
      collections={records}
      client={client}
      actor="admin"
      reload={() => {}}
      speciesRegistry={shared.species}
      locationsRegistry={shared.locations}
    />
  )

const editor = (client: ReturnType<typeof recordingClient>['client'], records = collections) =>
  render(element(client, records))

const collectionRows = (host: HTMLElement) => Array.from(host.querySelectorAll('ul')[0].querySelectorAll('button'))
const checkboxes = (host: HTMLElement) => Array.from(host.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]

afterEach(() => { document.body.innerHTML = '' })

describe('picking a collection', () => {
  it('lists collections with their organization and keeps the ID small', async () => {
    const { client } = recordingClient({ existing: stored })
    const { host } = editor(client)
    expect(collectionRows(host)).toHaveLength(2)
    expect(collectionRows(host)[1].textContent).toContain('Beta Lab')
    expect(host.querySelector('.font-mono')?.textContent).toBe('aaa')
  })

  it('saves against the version tags of the collection now on screen (bug 5)', async () => {
    const { calls, client } = recordingClient({ existing: stored })
    const { host } = editor(client)
    await click(collectionRows(host)[1])
    await click(checkboxes(host)[0])
    await click(button(host, 'Save species'))
    expect(lastOf(calls, 'replaceIfUnchanged').etag).toBe('bbb-species-etag')
    expect(lastOf(calls, 'replaceIfUnchanged').key).toBe('Collections/bbb/species.json')
  })

  it('drops the previous collection\'s undo buffer (bug 5)', async () => {
    const { client } = recordingClient({ existing: stored })
    const { host } = editor(client)
    await click(checkboxes(host)[0])
    expect(hasButton(host, 'Undo')).toBe(true)
    await click(collectionRows(host)[1])
    expect(hasButton(host, 'Undo')).toBe(false)
  })
})

describe('the checklist', () => {
  it('undoes one step and then stops offering (bug 13)', async () => {
    const { client } = recordingClient({ existing: stored })
    const { host } = editor(client)
    expect(checkboxes(host).map((box) => box.checked)).toEqual([false, true, false, true])
    await click(checkboxes(host)[0])
    expect(checkboxes(host)[0].checked).toBe(true)
    await click(button(host, 'Undo'))
    expect(checkboxes(host)[0].checked).toBe(false)
    expect(hasButton(host, 'Undo')).toBe(false)
  })

  it('counts what is used in a sentence', async () => {
    const { client } = recordingClient({ existing: stored })
    const { host } = editor(client)
    expect(host.textContent).toContain('1 of 3 species used here.')
  })

  it('will not save an empty list', async () => {
    const { client } = recordingClient({ existing: stored })
    const { host } = editor(client)
    await click(checkboxes(host)[1])
    expect(host.textContent).toContain('Keep at least one species in this collection.')
    expect((button(host, 'Save species') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('saving what a collection uses', () => {
  it('offers a retry when only the history entry fails (bug 6)', async () => {
    const { client } = recordingClient({
      existing: stored,
      onWrite: (key, attempt) => { if (key.endsWith('.applied.json') && attempt === 1) throw Error('storage hiccup') },
    })
    const { host } = editor(client)
    await click(checkboxes(host)[0])
    await click(button(host, 'Save species'))
    expect(host.textContent).toContain('The history entry for “Alpha” did not go through.')
    await click(button(host, 'Retry history entry'))
    expect(host.textContent).toContain('History entry saved.')
  })

  it('blocks that list until its history entry goes through, and leaves the others alone (fix 2)', async () => {
    const { calls, client } = recordingClient({
      existing: stored,
      onWrite: (key, attempt) => { if (key.endsWith('.applied.json') && attempt === 1) throw Error('storage hiccup') },
    })
    const { host } = editor(client)
    await click(checkboxes(host)[0])
    await click(button(host, 'Save species'))
    expect(host.textContent).toContain('The history entry for “Alpha” did not go through.')

    await click(checkboxes(host)[2])
    expect((button(host, 'Save species') as HTMLButtonElement).disabled).toBe(true)

    // The collection's own save keeps its own slot and is still available.
    await type(field(host, 'Description'), 'Updated study')
    expect((button(host, 'Save collection') as HTMLButtonElement).disabled).toBe(false)

    const retries = Array.from(host.querySelectorAll('button')).filter((one) => one.textContent === 'Retry history entry')
    expect(retries).toHaveLength(1)
    await click(retries[0])
    expect((button(host, 'Save species') as HTMLButtonElement).disabled).toBe(false)
    expect(calls.filter((call) => call.key.endsWith('.applied.json'))).toHaveLength(1)
  })

  it('creates the file and picks up its version when none exists yet', async () => {
    const fresh = [{ ...collections[0], speciesAssignment: { values: [shared.species[0]], etag: null } }]
    const { calls, client } = recordingClient({ existing: { 'Collections/aaa/collection.json': 'aaa-collection-etag' } })
    const { host } = editor(client, fresh)
    await click(checkboxes(host)[0])
    await click(button(host, 'Save species'))
    expect(calls.map((call) => call.method)).toEqual(['writeImmutable', 'writeImmutable', 'statObject', 'writeImmutable'])
    await click(checkboxes(host)[2])
    await click(button(host, 'Save species'))
    expect(lastOf(calls, 'replaceIfUnchanged').key).toBe('Collections/aaa/species.json')
  })
})

describe('a reload landing on an open draft (fix 1)', () => {
  it('keeps the draft and offers the change when the collection moved underneath', async () => {
    const { client } = recordingClient({ existing: stored })
    const view = editor(client)
    await type(field(view.host, 'Description'), 'My unsaved study')

    const theirs = collections.map((entry) => (entry.key === collections[0].key
      ? { ...entry, etag: 'aaa-collection-v2', document: { ...entry.document, organizationProperty: 'Renamed Lab' } }
      : entry))
    view.rerender(element(client, theirs))
    expect(field(view.host, 'Description').value).toBe('My unsaved study')
    expect(view.host.textContent).toContain('Someone else changed this collection. Reload to see their changes.')

    await click(button(view.host, 'Reload'))
    expect(field(view.host, 'Organization').value).toBe('Renamed Lab')
    expect(view.host.textContent).not.toContain('Reload to see their changes')
  })

  it('takes the new version tags quietly when only they moved', async () => {
    const { calls, client } = recordingClient({ existing: { ...stored, 'Collections/aaa/collection.json': 'aaa-collection-v2' } })
    const view = editor(client)
    await type(field(view.host, 'Description'), 'My unsaved study')
    view.rerender(element(client, collections.map((entry) => (entry.key === collections[0].key ? { ...entry, etag: 'aaa-collection-v2' } : entry))))
    expect(view.host.textContent).not.toContain('Reload to see their changes')
    await click(button(view.host, 'Save collection'))
    expect(lastOf(calls, 'replaceIfUnchanged').etag).toBe('aaa-collection-v2')
  })
})

describe('collection details', () => {
  it('saves the metadata against the collection version it loaded', async () => {
    const { calls, client } = recordingClient({ existing: stored })
    const { host } = editor(client)
    await type(field(host, 'Description'), 'Updated study')
    await click(button(host, 'Save collection'))
    expect(lastOf(calls, 'replaceIfUnchanged').etag).toBe('aaa-collection-etag')
    expect(host.textContent).toContain('Saved.')
  })
})
