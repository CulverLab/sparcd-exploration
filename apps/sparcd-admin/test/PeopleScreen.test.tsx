// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { PeopleScreen, collectionsText, lastActiveText } from '../src/PeopleScreen'
import { inviteLink, inviteMailto } from '../src/InviteLink'
import { button, click, field, hasButton, render, settle, type } from './dom'
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
