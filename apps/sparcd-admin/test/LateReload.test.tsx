// @vitest-environment jsdom
// A reload reads every list, and against real storage that takes seconds. What
// the administrator does in the meantime has to survive the answer landing.
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { S3Config } from '@sparcd/types'
import { App } from '../src/App'
import { button, click, field, render, rowButtons, settle, type } from './dom'
import { config, fakeStorage, settingsStore } from './storage'
import { fakeApi, noService } from './fakeApi'
import type { MakeApi } from '../src/App'

type Message = { type: string; config?: S3Config }
const channels: FakeChannel[] = []
class FakeChannel {
  listeners: ((event: { data: Message }) => void)[] = []
  constructor(public name: string) { channels.push(this) }
  addEventListener(_type: string, listener: (event: { data: Message }) => void) { this.listeners.push(listener) }
  removeEventListener(_type: string, listener: (event: { data: Message }) => void) {
    this.listeners = this.listeners.filter((one) => one !== listener)
  }
  postMessage(data: Message) {
    for (const other of channels) {
      if (other === this || other.name !== this.name) continue
      for (const listener of [...other.listeners]) listener({ data })
    }
  }
  close() {}
}
;(globalThis as unknown as { BroadcastChannel: unknown }).BroadcastChannel = FakeChannel

const mounted: { unmount: () => void }[] = []
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
})

const section = (host: HTMLElement, title: string) =>
  host.querySelector(`section[aria-labelledby="${title}-heading"]`) as HTMLElement
const collectionsSection = (host: HTMLElement) =>
  host.querySelector('section[aria-labelledby="collections-heading"]') as HTMLElement

/** An app whose reads only answer when the test lets them. */
function openHeld(makeApi: MakeApi = noService) {
  let pending: (() => void)[] = []
  let holding = false
  const storage = fakeStorage(settingsStore(), {}, () => {
    if (!holding) return undefined
    return new Promise<void>((resolve) => pending.push(resolve))
  })
  sessionStorage.setItem('sparcd-connection-tab', JSON.stringify(config))
  const view = render(<App makeClient={(_c, read, write) => storage.make(read, write)} makeApi={makeApi} />)
  mounted.push(view)
  const release = async () => {
    holding = false
    let guard = 0
    while (pending.length && guard++ < 300) {
      const batch = pending
      pending = []
      await act(async () => { for (const resolve of batch) resolve() })
    }
    await settle()
  }
  return { view, storage, hold: () => { holding = true }, release, held: () => pending.length }
}

/** Rename a species and save, leaving the reload it triggers in flight. */
async function saveSpeciesWithReloadInFlight(app: ReturnType<typeof openHeld>) {
  const species = section(app.view.host, 'Species')
  await click(rowButtons(species)[0])
  await type(field(species, 'Common name'), 'Coyote (plains)')
  app.hold()
  await click(button(species, 'Save'))
  await settle()
  expect(app.held()).toBeGreaterThan(0)
}

describe('what the administrator does while a reload is in flight', () => {
  it('keeps a retire clicked in Locations after the reload lands', async () => {
    const app = openHeld()
    await settle()
    await saveSpeciesWithReloadInFlight(app)

    const locations = () => section(app.view.host, 'Locations')
    await click(rowButtons(locations())[0])
    await click(button(locations(), 'Retire'))
    expect(rowButtons(locations())[0].textContent).toContain('Retired')

    await app.release()

    expect(rowButtons(locations())[0].textContent).toContain('Retired')
    expect(locations().textContent).toContain('1 location changed')
  })

  // The reload landing between the two clicks used to close the open record,
  // so the click aimed at Retire hit nothing and the row stayed Active.
  it('keeps the open record open when the reload lands between two clicks', async () => {
    const app = openHeld()
    await settle()
    await saveSpeciesWithReloadInFlight(app)

    const locations = () => section(app.view.host, 'Locations')
    await click(rowButtons(locations())[0])
    await app.release()

    await click(button(locations(), 'Retire'))
    expect(rowButtons(locations())[0].textContent).toContain('Retired')
    expect(locations().textContent).toContain('1 location changed')
  })

  it('keeps text typed into Locations after the reload lands', async () => {
    const app = openHeld()
    await settle()
    await saveSpeciesWithReloadInFlight(app)

    const locations = () => section(app.view.host, 'Locations')
    await click(rowButtons(locations())[0])
    await type(field(locations(), 'Name'), 'Apache Pass north')

    await app.release()

    expect(field(locations(), 'Name').value).toBe('Apache Pass north')
    expect(locations().textContent).toContain('1 location changed')
  })

  it('keeps a collection field edited while the reload is in flight', async () => {
    const app = openHeld()
    await settle()
    await saveSpeciesWithReloadInFlight(app)

    const collections = () => collectionsSection(app.view.host)
    await type(field(collections(), 'Organization'), 'Culver Lab')

    await app.release()

    expect(field(collections(), 'Organization').value).toBe('Culver Lab')
    expect(collections().textContent).not.toContain('Someone else changed this collection')
  })

  it('keeps a species unpicked in a collection while the reload is in flight', async () => {
    const app = openHeld()
    await settle()
    await saveSpeciesWithReloadInFlight(app)

    const collections = () => collectionsSection(app.view.host)
    const boxes = () => Array.from(collections().querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[]
    const at = boxes().findIndex((box) => box.checked)
    await click(boxes()[at])

    await app.release()

    expect(boxes()[at].checked).toBe(false)
  })

  it('keeps a person added to a collection while the reload is in flight', async () => {
    const { api } = fakeApi()
    const app = openHeld(() => api)
    await settle()
    await saveSpeciesWithReloadInFlight(app)

    const members = () => app.view.host.querySelector('section[aria-labelledby^="members-"]') as HTMLElement
    await type(members().querySelector('input[type="text"], input:not([type])') as HTMLInputElement, 'Ana')
    await click(button(members(), 'Ana Morales'))
    expect(members().textContent).toContain('Ana Morales')

    await app.release()

    expect(members().textContent).toContain('Ana Morales')
    expect(button(members(), 'Save people').hasAttribute('disabled')).toBe(false)
  })
})

describe('other tabs', () => {
  it('ignores a sibling relaying the connection this tab already has', async () => {
    const app = openHeld()
    await settle()
    const before = app.storage.log.length
    const sibling = new FakeChannel('sparcd-connection-live')
    await act(async () => { sibling.postMessage({ type: 'connect', config }) })
    await settle()
    expect(app.storage.log.length).toBe(before)
  })
})
