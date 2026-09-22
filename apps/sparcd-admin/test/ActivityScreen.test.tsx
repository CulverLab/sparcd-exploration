// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { ActivityScreen } from '../src/ActivityScreen'
import { TRUNCATION_NOTE } from '../src/activity'
import { render, settle } from './dom'
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
