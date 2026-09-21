// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { S3Config } from '@sparcd/types'
import { App } from '../src/App'
import { button, click, field, hasButton, render, rowButtons, settle, type } from './dom'
import { config, fakeStorage, httpError, settingsStore, type Store } from './storage'
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

const open = (store: Store, faults: Record<string, () => Error> = {}, makeApi: MakeApi = noService) => {
  const storage = fakeStorage(store, faults)
  sessionStorage.setItem('sparcd-connection-tab', JSON.stringify(config))
  const view = render(<App makeClient={(_config, read, write) => storage.make(read, write)} makeApi={makeApi} />)
  mounted.push(view)
  return { storage, view }
}

const probes = (log: string[]) => log.filter((entry) => entry.includes('Settings/admin-sessions/')).length
const speciesSection = (host: HTMLElement) => host.querySelector('section[aria-labelledby="Species-heading"]') as HTMLElement
const locationsSection = (host: HTMLElement) => host.querySelector('section[aria-labelledby="Locations-heading"]') as HTMLElement

beforeEach(() => { sessionStorage.clear() })
afterEach(() => {
  // The live-connection channel is a module singleton, so each App has to be
  // unmounted or its subscription answers the next test's sibling tab too.
  while (mounted.length) mounted.pop()!.unmount()
  document.body.innerHTML = ''
})

describe('opening and reloading (bug 9)', () => {
  it('loads the lists once and checks writing once', async () => {
    const { storage } = open(settingsStore())
    await settle()
    expect(storage.count('get sparcd-settings-a/Settings/species.json')).toBe(1)
    expect(probes(storage.log)).toBe(1)
  })

  it('reloads after a save without logging in again', async () => {
    const { storage, view } = open(settingsStore())
    await settle()
    const section = speciesSection(view.host)
    await click(rowButtons(section)[0])
    await type(field(section, 'Common name'), 'Coyote (plains)')
    await click(button(section, 'Save'))
    await settle()
    expect(storage.count('get sparcd-settings-a/Settings/species.json')).toBe(2)
    expect(probes(storage.log)).toBe(1)
  })

  it('keeps the session and says what happened when a reload fails', async () => {
    const faults: Record<string, () => Error> = {}
    const { storage, view } = open(settingsStore(), faults)
    await settle()
    const section = speciesSection(view.host)
    await click(rowButtons(section)[0])
    await type(field(section, 'Common name'), 'Coyote (plains)')
    storage.log.length = 0
    faults['sparcd-settings-a/Settings/species.json'] = () => httpError('InternalError', 500)
    await click(button(section, 'Save'))
    await settle()
    expect(view.host.textContent).toContain('The lists could not be reloaded.')
    expect(speciesSection(view.host)).not.toBeNull()
    expect(probes(storage.log)).toBe(0)
  })
})

describe('drafts while something else is saved (fix 1)', () => {
  it('leaves an unsaved draft in another list alone', async () => {
    const { view } = open(settingsStore())
    await settle()
    await click(rowButtons(locationsSection(view.host))[0])
    await type(field(locationsSection(view.host), 'Name'), 'Apache Pass north')
    await click(rowButtons(speciesSection(view.host))[0])
    await type(field(speciesSection(view.host), 'Common name'), 'Coyote (plains)')
    await click(button(speciesSection(view.host), 'Save'))
    await settle()
    expect(field(locationsSection(view.host), 'Name').value).toBe('Apache Pass north')
    expect(view.host.textContent).not.toContain('Reload to see their changes')
  })
})

describe('a load that finishes late (fix 3)', () => {
  it('does not install an older login over a newer one', async () => {
    const slowStore = settingsStore()
    slowStore['sparcd-settings-a']['Settings/species.json'] = [{ name: 'Older', scientificName: 'Canis latrans' }]
    const fastStore = settingsStore()
    fastStore['sparcd-settings-a']['Settings/species.json'] = [{ name: 'Newer', scientificName: 'Puma concolor' }]
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const slow = fakeStorage(slowStore, {}, (entry) => (entry.endsWith('Settings/species.json') ? held : undefined))
    const fast = fakeStorage(fastStore)

    sessionStorage.setItem('sparcd-connection-tab', JSON.stringify(config))
    const view = render(<App makeClient={(target, read, write) => (target.accessKey === config.accessKey ? slow : fast).make(read, write)} makeApi={noService} />)
    mounted.push(view)
    await settle()

    const sibling = new FakeChannel('sparcd-connection-live')
    await act(async () => { sibling.postMessage({ type: 'connect', config: { ...config, accessKey: 'OTHERKEY' } }) })
    await act(async () => { release() })

    expect(speciesSection(view.host).textContent).toContain('Newer')
    expect(speciesSection(view.host).textContent).not.toContain('Older')
  })
})

const sidebar = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('nav[aria-label="Sections"]')[0].querySelectorAll('button')).map((one) => one.textContent)

describe('what this login can manage', () => {
  it('works as before when the storage does not manage people', async () => {
    const { view } = open(settingsStore())
    await settle()
    expect(sidebar(view.host)).toEqual(['Species', 'Locations', 'Collections', 'Settings'])
    expect(view.host.textContent).not.toContain('People')
  })

  it('adds People after Collections, and Activity, for an administrator', async () => {
    const { api } = fakeApi()
    const { view } = open(settingsStore(), {}, () => api)
    await settle()
    expect(sidebar(view.host)).toEqual(['Species', 'Locations', 'Collections', 'People', 'Activity', 'Settings'])
  })

  it('uses the name the service knows as the administrator identity', async () => {
    const { api } = fakeApi()
    const { view } = open(settingsStore(), {}, () => api)
    await settle()
    expect(view.host.textContent).toContain('Jorge Delgado')
  })

  it('stops a login that is not an administrator with one plain screen', async () => {
    const { api } = fakeApi({ me: { id: 'p1', name: 'Ana Morales', email: 'ana@example.org', admin: false, collections: [] } })
    const { view } = open(settingsStore(), {}, () => api)
    await settle()
    expect(view.host.textContent).toContain("This login can't manage SPARC'd.")
    expect(view.host.textContent).toContain('Ask an administrator for access.')
    expect(hasButton(view.host, 'Logout')).toBe(true)
    expect(view.host.querySelector('nav[aria-label="Sections"]')).toBeNull()
  })
})

describe('the sign-in screen (bug 11)', () => {
  it('shows the real problem rather than a guess about the storage', async () => {
    const { view } = open(settingsStore(), {
      'sparcd-settings-a/Settings/locations.json': () => httpError('SignatureDoesNotMatch', 403),
    })
    await settle()
    expect(view.host.querySelector('[role="alert"]')?.textContent).toBe('The login ID or secret was not accepted.')
  })
})

describe('answering another tab (bug 12)', () => {
  it('hands its live connection to a tab that asks for one', async () => {
    open(settingsStore())
    await settle()
    const sibling = new FakeChannel('sparcd-connection-live')
    const heard: Message[] = []
    sibling.addEventListener('message', (event) => heard.push(event.data))
    sibling.postMessage({ type: 'request' })
    expect(heard).toEqual([{ type: 'connect', config }])
  })
})
