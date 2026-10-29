// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { PeopleScreen, collectionsText, lastActiveText } from '../src/PeopleScreen'
import { inviteLink, inviteMailto } from '../src/InviteLink'
import { button, click, field, hasButton, render, settle, type } from './dom'
import { ApiError } from '../src/api'
import { fakeApi, person } from './fakeApi'
import type { Access, AccessApi, Person } from '../src/api'
import { useState } from 'react'

const collections = [{ bucket: 'sparcd-aaa', name: 'Sky Islands 2026' }, { bucket: 'sparcd-bbb', name: 'Research 1' }]

// The app owns the list now, so the test stands in for it: one piece of state,
// one refresh, handed to the screen the way App hands it over.
function Host({ api }: { api: AccessApi }) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const refresh = async () => { setPeople(await api.listPeople()) }
  return <PeopleScreen api={api} people={people} refresh={refresh} endpoint="storage.test" collections={collections} from="Jorge Delgado" />
}

const screen = async (state: Parameters<typeof fakeApi>[0] = {}) => {
  const { api, calls, data } = fakeApi(state)
  const view = render(<Host api={api} />)
  await settle()
  return { view, calls, data }
}

const rowFor = (host: HTMLElement, name: string) =>
  Array.from(host.querySelectorAll('li button')).find((one) => one.textContent?.includes(name))!

const box = (host: HTMLElement, label: string) => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement

afterEach(() => { document.body.innerHTML = '' })

describe('the list', () => {
  it('reads dates and collections in plain words', () => {
    const now = new Date('2026-09-16T12:00:00.000Z')
    expect(lastActiveText(null, now)).toBe('Not yet')
    expect(lastActiveText('2026-09-16T08:00:00.000Z', now)).toBe('Today')
    expect(lastActiveText('2026-09-15T08:00:00.000Z', now)).toBe('Yesterday')
    expect(collectionsText(person('p1', 'Ana', { collections: [] }))).toBe('None yet')
    expect(collectionsText(person('p1', 'Ana', {
      collections: [
        { bucket: 'a', name: 'One', access: ['look'], exactLocations: false },
        { bucket: 'b', name: 'Two', access: ['look'], exactLocations: false },
        { bucket: 'c', name: 'Three', access: ['look'], exactLocations: false },
      ],
    }))).toBe('3 collections')
  })

  it('shows everyone with a status, and no email column', async () => {
    const { view } = await screen()
    expect(rowFor(view.host, 'Ana Morales').textContent).toContain('Active')
    expect(rowFor(view.host, 'Luis Park').textContent).toContain('Invited')
    expect(rowFor(view.host, 'Ana Morales').textContent).not.toContain('@example.org')
  })
})

describe('adding a person', () => {
  it('shows the single-use link with a copy button and an email draft', async () => {
    const { view, calls } = await screen()
    await click(button(view.host, 'Add a person'))
    await type(field(view.host, 'Name'), 'Sam Whitfield')
    await type(field(view.host, 'Email'), 'sam@example.org')
    await click(button(view.host, 'Add person'))
    await settle()

    expect(calls.map((call) => call.name)).toContain('addPerson')
    expect(view.host.textContent).toContain('Send Sam this link. It works once and expires in 7 days.')
    const link = field(view.host, 'Link to send')
    expect(link.value).toBe(inviteLink('storage.test', 'token-1'))
    expect(link.value).toBe('http://localhost:3000/sparcd-exploration/admin/join.html#e=storage.test&t=token-1')

    await click(button(view.host, 'Copy'))
    expect(hasButton(view.host, 'Copied')).toBe(true)

    const mail = view.host.querySelector('a[href^="mailto:"]') as HTMLAnchorElement
    expect(decodeURIComponent(mail.href)).toContain('Hi Sam,')
    expect(decodeURIComponent(mail.href)).toContain('It opens once and expires in 7 days.')
  })

  it('offers every collection as a row and sends only the ones with boxes ticked', async () => {
    const { view, calls } = await screen()
    await click(button(view.host, 'Add a person'))
    await type(field(view.host, 'Name'), 'Sam Whitfield')
    await type(field(view.host, 'Email'), 'sam@example.org')
    expect(box(view.host, 'Can look for Sky Islands 2026').checked).toBe(false)
    expect(box(view.host, 'Can look for Research 1').checked).toBe(false)
    await click(box(view.host, 'Runs this collection for Sky Islands 2026'))
    await click(box(view.host, 'Can upload for Sky Islands 2026'))
    await click(box(view.host, 'Can upload for Research 1'))
    await click(box(view.host, 'Can upload for Research 1'))
    await click(box(view.host, 'Sees exact camera locations for Research 1'))
    await click(button(view.host, 'Add person'))
    await settle()
    expect((calls.find((call) => call.name === 'addPerson')!.args[0] as { memberships: unknown }).memberships).toEqual([
      { bucket: 'sparcd-aaa', access: ['look', 'upload', 'run'], exactLocations: false },
    ])
  })

  it('writes a friendly mail body addressed to the first name', () => {
    const href = inviteMailto('sam@example.org', 'Sam Whitfield', 'https://x/join', 'Jorge Delgado')
    expect(href.startsWith('mailto:sam%40example.org?')).toBe(true)
    const body = decodeURIComponent(href)
    expect(body).toContain('Hi Sam,')
    expect(body).toContain('https://x/join')
    expect(body).toContain('Jorge Delgado')
  })
})

describe('one person at a time (contract 1.1)', () => {
  const withMembership = {
    people: [person('p1', 'Ana Morales', {
      collections: [{ bucket: 'sparcd-aaa', uuid: 'aaa', name: 'Sky Islands 2026', access: ['look'] as Access[], exactLocations: false }],
    })],
  }

  it('shows every collection, ticked where they are a member', async () => {
    const { view } = await screen(withMembership)
    await click(rowFor(view.host, 'Ana Morales'))
    expect(box(view.host, 'Can look for Sky Islands 2026').checked).toBe(true)
    expect(box(view.host, 'Can identify for Sky Islands 2026').checked).toBe(false)
    for (const label of ['Can look', 'Can identify', 'Can upload', 'Runs this collection', 'Sees exact camera locations']) {
      expect(box(view.host, `${label} for Research 1`).checked).toBe(false)
    }
    expect((button(view.host, 'Save access') as HTMLButtonElement).disabled).toBe(true)
  })

  it('adds to a collection through the per-person call', async () => {
    const { view, calls } = await screen()
    await click(rowFor(view.host, 'Ana Morales'))
    await click(box(view.host, 'Can identify for Research 1'))
    expect(box(view.host, 'Can look for Research 1').checked).toBe(true)
    await click(box(view.host, 'Sees exact camera locations for Research 1'))
    await click(button(view.host, 'Save access'))
    await settle()
    expect(calls.filter((call) => call.name === 'setMember').map((call) => call.args)).toEqual([
      ['sparcd-bbb', 'p1', { access: ['look', 'identify'], exactLocations: true }],
    ])
    expect(calls.some((call) => call.name === 'setMembers')).toBe(false)
  })

  it('sets several collections in one save', async () => {
    const { view, calls } = await screen(withMembership)
    await click(rowFor(view.host, 'Ana Morales'))
    await click(box(view.host, 'Can upload for Sky Islands 2026'))
    await click(box(view.host, 'Can upload for Research 1'))
    await click(button(view.host, 'Save access'))
    await settle()
    expect(calls.filter((call) => call.name === 'setMember').map((call) => call.args)).toEqual([
      ['sparcd-aaa', 'p1', { access: ['look', 'upload'], exactLocations: false }],
      ['sparcd-bbb', 'p1', { access: ['upload'], exactLocations: false }],
    ])
  })

  it('does not write a collection where nothing but the location box is ticked', async () => {
    const { view } = await screen()
    await click(rowFor(view.host, 'Ana Morales'))
    await click(box(view.host, 'Sees exact camera locations for Research 1'))
    expect((button(view.host, 'Save access') as HTMLButtonElement).disabled).toBe(true)
    expect(view.host.textContent).not.toContain('Will be removed')
  })

  it('sends the change to the person it was opened for, even if the selection moved', async () => {
    const { api, calls, data } = fakeApi({
      people: [
        person('p1', 'Ana Morales', {
          collections: [{ bucket: 'sparcd-aaa', uuid: 'aaa', name: 'Sky Islands 2026', access: ['look'], exactLocations: false }],
        }),
        person('p2', 'Luis Park'),
      ],
    })
    let release: (() => void) | null = null
    const setMember = api.setMember.bind(api)
    api.setMember = async (...args: Parameters<typeof setMember>) => {
      await new Promise<void>((resolve) => { release = resolve })
      return setMember(...args)
    }
    const view = render(<Host api={api} />)
    await settle()

    await click(rowFor(view.host, 'Ana Morales'))
    await click(box(view.host, 'Can upload for Sky Islands 2026'))
    await click(button(view.host, 'Save access'))
    await click(rowFor(view.host, 'Luis Park'))
    await act(async () => { release!() })
    await settle()

    expect(calls.find((call) => call.name === 'setMember')!.args).toEqual([
      'sparcd-aaa', 'p1', { access: ['look', 'upload'], exactLocations: false },
    ])
    expect(data.people.find((one) => one.id === 'p2')!.collections).toEqual([])
  })

  it('shows an unticked membership as leaving, then removes it through the per-person call', async () => {
    const { view, calls } = await screen(withMembership)
    await click(rowFor(view.host, 'Ana Morales'))
    await click(box(view.host, 'Can look for Sky Islands 2026'))
    const row = box(view.host, 'Can look for Sky Islands 2026').closest('tr')!
    expect(row.textContent).toContain('Will be removed')
    expect(box(view.host, 'Can look for Research 1').closest('tr')!.textContent).not.toContain('Will be removed')
    await click(button(view.host, 'Save access'))
    await settle()
    expect(calls.find((call) => call.name === 'removeMember')!.args).toEqual(['sparcd-aaa', 'p1'])
    expect(calls.some((call) => call.name === 'setMember')).toBe(false)
  })

  it('Undo changes puts the boxes back', async () => {
    const { view } = await screen(withMembership)
    await click(rowFor(view.host, 'Ana Morales'))
    await click(box(view.host, 'Can look for Sky Islands 2026'))
    await click(button(view.host, 'Undo changes'))
    expect(box(view.host, 'Can look for Sky Islands 2026').checked).toBe(true)
    expect(view.host.textContent).not.toContain('Will be removed')
  })

  it('turns a refusal into one plain sentence', async () => {
    const { api, calls } = fakeApi()
    const failing = { ...api, updatePerson: async () => { throw new ApiError(409, 'last_admin', 'cannot demote') } }
    const view = render(<Host api={failing as never} />)
    await settle()
    await click(rowFor(view.host, 'Ana Morales'))
    await click(button(view.host, 'Pause access'))
    await click(button(view.host, 'Yes, pause access'))
    await settle()
    expect(view.host.textContent).toContain("SPARC'd always needs at least one administrator.")
    expect(calls).toBeDefined()
  })

  const soleRunner = {
    people: [person('p1', 'Ana Morales')],
    collections: [{
      bucket: 'sparcd-aaa', uuid: 'aaa', name: 'Sky Islands 2026', organization: '', membersVersion: 'members-v1',
      members: [{ personId: 'p1', name: 'Ana Morales', access: ['look', 'run'] as Access[], exactLocations: false }],
    }],
  }
  const SOLE_RUNNER = 'Ana Morales is the only person running one of their collections. Have someone else run it first.'

  it("asks for another runner before pausing a collection's only one", async () => {
    const { view } = await screen(soleRunner)
    await click(rowFor(view.host, 'Ana Morales'))
    await click(button(view.host, 'Pause access'))
    await click(button(view.host, 'Yes, pause access'))
    await settle()
    expect(view.host.textContent).toContain(SOLE_RUNNER)
  })

  it('keeps the boxes and says why when a save would leave nobody running it', async () => {
    const { view, calls } = await screen({
      ...soleRunner,
      people: [person('p1', 'Ana Morales', {
        collections: [{ bucket: 'sparcd-aaa', name: 'Sky Islands 2026', access: ['look', 'run'], exactLocations: false }],
      })],
    })
    await click(rowFor(view.host, 'Ana Morales'))
    await click(box(view.host, 'Runs this collection for Sky Islands 2026'))
    await click(button(view.host, 'Save access'))
    await settle()
    expect(calls.some((call) => call.name === 'setMember')).toBe(true)
    expect(view.host.textContent).toContain('A collection always needs at least one person running it who has joined and is not paused.')
    expect(box(view.host, 'Runs this collection for Sky Islands 2026').checked).toBe(false)
  })

  it('says the same before resetting its only runner', async () => {
    const { view } = await screen(soleRunner)
    await click(rowFor(view.host, 'Ana Morales'))
    await click(button(view.host, 'Reset access'))
    await click(button(view.host, 'Yes, reset access'))
    await settle()
    expect(view.host.textContent).toContain(SOLE_RUNNER)
  })
})

describe('if something is wrong', () => {
  it('asks before pausing, then pauses', async () => {
    const { view, calls } = await screen()
    await click(rowFor(view.host, 'Ana Morales'))
    await click(button(view.host, 'Pause access'))
    expect(view.host.textContent).toContain("Pause Ana Morales's access? They keep their collections but can't sign in until you resume.")
    expect(calls.some((call) => call.name === 'updatePerson')).toBe(false)

    await click(button(view.host, 'Yes, pause access'))
    await settle()
    expect(calls.find((call) => call.name === 'updatePerson')!.args).toEqual(['p1', { status: 'paused' }])
    expect(rowFor(view.host, 'Ana Morales').textContent).toContain('Paused')
    expect(hasButton(view.host, 'Resume access')).toBe(true)
  })

  it('asks before resetting, then hands over a fresh link', async () => {
    const { view, calls } = await screen()
    await click(rowFor(view.host, 'Ana Morales'))
    expect(view.host.textContent).toContain('Use this if their laptop was lost. Their current sign-in stops working and you get a new invite link to send them.')
    await click(button(view.host, 'Reset access'))
    expect(calls.some((call) => call.name === 'resetPerson')).toBe(false)

    await click(button(view.host, 'Yes, reset access'))
    await settle()
    expect(calls.find((call) => call.name === 'resetPerson')!.args).toEqual(['p1'])
    expect(field(view.host, 'Link to send').value).toContain('t=reset-1')
  })

  it('does not offer acting on someone else\'s behalf', async () => {
    const { view } = await screen()
    await click(rowFor(view.host, 'Ana Morales'))
    expect(view.host.textContent).not.toContain('Open Uploader as')
  })
})
