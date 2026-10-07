// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityScreen } from '../src/ActivityScreen'
import { TRUNCATION_NOTE } from '../src/activity'
import { button, click, render, settle, type } from './dom'
import { fakeApi } from './fakeApi'
import type { ActivityEvent } from '../src/api'

const collections = [{ bucket: 'sparcd-aaa', name: 'Sky Islands 2026' }]

const events: ActivityEvent[] = [
  { ts: '2026-09-12T14:03:00.000Z', personName: 'Priya Nair', kind: 'download', bucket: 'sparcd-aaa', key: 'a/IMG_0412.JPG' },
]

const screen = async (truncated: boolean) => {
  const { api } = fakeApi({ events, truncated })
  const view = render(<ActivityScreen api={api} collections={collections} people={[]} />)
  await settle()
  return view
}

const lookupScreen = async () => {
  const fake = fakeApi({ events, downloads: [] })
  const view = render(<ActivityScreen api={fake.api} collections={collections} people={[]} />)
  await settle()
  return { ...view, calls: fake.calls }
}

const choose = (host: HTMLElement, id: string, value: string) =>
  act(async () => {
    const select = host.querySelector(`#${id}`) as HTMLSelectElement
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    setter.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

const dateField = (host: HTMLElement, id: string) => host.querySelector(`#${id}`) as HTMLInputElement

afterEach(() => { document.body.innerHTML = '' })

describe('more events than the service will return', () => {
  it('says so in a plain sentence', async () => {
    const view = await screen(true)
    expect(view.host.textContent).toContain(TRUNCATION_NOTE)
  })

  it('says nothing when the answer is complete', async () => {
    const view = await screen(false)
    expect(view.host.textContent).not.toContain(TRUNCATION_NOTE)
  })
})

describe('the dates the download lookup asks about', () => {
  const askFor = async (from: string, to: string) => {
    const view = await lookupScreen()
    await choose(view.host, 'lookup-range', 'custom')
    await type(dateField(view.host, 'lookup-from'), from)
    await type(dateField(view.host, 'lookup-to'), to)
    await type(view.host.querySelector('#lookup-name') as HTMLInputElement, 'IMG_0412.JPG')
    await click(button(view.host, 'Look it up'))
    return view
  }

  it('sends the chosen dates with the question', async () => {
    const view = await askFor('2026-08-01', '2026-08-31')
    const asked = view.calls.filter((call) => call.name === 'downloadsOf')
    expect(asked).toHaveLength(1)
    expect(asked[0].args[2]).toMatchObject({ from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T23:59:59.999Z' })
  })

  it('refuses a range wider than 31 days before asking', async () => {
    const view = await askFor('2026-08-01', '2026-09-10')
    expect(view.calls.some((call) => call.name === 'downloadsOf')).toBe(false)
    expect(view.host.textContent).toContain('Pick a range of 31 days or less.')
  })
})
