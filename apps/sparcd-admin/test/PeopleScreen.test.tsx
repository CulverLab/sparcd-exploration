// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { PeopleScreen, collectionsText, lastActiveText } from '../src/PeopleScreen'
import { inviteLink, inviteMailto } from '../src/InviteLink'
import { button, click, field, hasButton, render, settle, type } from './dom'
import { ApiError } from '../src/api'
import { fakeApi, person } from './fakeApi'

const collections = [{ bucket: 'sparcd-aaa', name: 'Sky Islands 2026' }]

const screen = async (state: Parameters<typeof fakeApi>[0] = {}) => {
  const { api, calls, data } = fakeApi(state)
  const view = render(<PeopleScreen api={api} endpoint="storage.test" collections={collections} from="Jorge Delgado" />)
  await settle()
  return { view, calls, data }
}

const rowFor = (host: HTMLElement, name: string) =>
  Array.from(host.querySelectorAll('li button')).find((one) => one.textContent?.includes(name))!

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
        { bucket: 'a', name: 'One', access: 'look', exactLocations: false },
        { bucket: 'b', name: 'Two', access: 'look', exactLocations: false },
        { bucket: 'c', name: 'Three', access: 'look', exactLocations: false },
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
      collections: [{ bucket: 'sparcd-aaa', uuid: 'aaa', name: 'Sky Islands 2026', access: 'look' as const, exactLocations: false }],
    })],
  }

  it('adds to a collection through the per-person call', async () => {
    const { view, calls } = await screen()
    await click(rowFor(view.host, 'Ana Morales'))
    await click(button(view.host, 'Add to a collection'))
    await click(view.host.querySelector('input[type="checkbox"]')!)
    await click(button(view.host, 'Add to collection'))
    await settle()
    expect(calls.find((call) => call.name === 'setMember')!.args).toEqual([
      'sparcd-aaa', 'p1', { access: 'identify', exactLocations: true },
    ])
    expect(calls.some((call) => call.name === 'setMembers')).toBe(false)
  })

  it('changes one membership without rewriting the list', async () => {
    const { view, calls } = await screen(withMembership)
    await click(rowFor(view.host, 'Ana Morales'))
    expect(view.host.textContent).toContain('Sky Islands 2026 · Can look')
    await click(button(view.host, 'Change'))
    await click(view.host.querySelectorAll('input[type="radio"]')[2])
    await click(button(view.host, 'Save access'))
    await settle()
    expect(calls.find((call) => call.name === 'setMember')!.args).toEqual([
      'sparcd-aaa', 'p1', { access: 'upload', exactLocations: false },
    ])
  })

  it('removes one membership through the per-person call', async () => {
    const { view, calls } = await screen(withMembership)
    await click(rowFor(view.host, 'Ana Morales'))
    await click(button(view.host, 'Remove'))
    await settle()
    expect(calls.find((call) => call.name === 'removeMember')!.args).toEqual(['sparcd-aaa', 'p1'])
  })

  it('turns a refusal into one plain sentence', async () => {
    const { api, calls } = fakeApi()
    const failing = { ...api, updatePerson: async () => { throw new ApiError(409, 'last_admin', 'cannot demote') } }
    const view = render(<PeopleScreen api={failing as never} endpoint="storage.test" collections={collections} from="Jorge Delgado" />)
    await settle()
    await click(rowFor(view.host, 'Ana Morales'))
    await click(button(view.host, 'Pause access'))
    await click(button(view.host, 'Yes, pause access'))
    await settle()
    expect(view.host.textContent).toContain("SPARC'd always needs at least one administrator.")
    expect(calls).toBeDefined()
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
