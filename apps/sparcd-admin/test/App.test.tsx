// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { S3Config } from '@sparcd/types'
import { App } from '../src/App'
import { button, click, field, render, rowButtons, settle, type } from './dom'
import { config, fakeStorage, httpError, settingsStore, type Store } from './storage'

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

const open = (store: Store, faults: Record<string, () => Error> = {}) => {
  const storage = fakeStorage(store, faults)
  sessionStorage.setItem('sparcd-connection-tab', JSON.stringify(config))
  const view = render(<App makeClient={(_config, read, write) => storage.make(read, write)} />)
  mounted.push(view)
  return { storage, view }
}

const probes = (log: string[]) => log.filter((entry) => entry.includes('Settings/admin-sessions/')).length
const speciesSection = (host: HTMLElement) => host.querySelector('section[aria-labelledby="Species-heading"]') as HTMLElement

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
