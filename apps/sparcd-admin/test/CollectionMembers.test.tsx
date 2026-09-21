// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { CollectionMembers, RUNNER_SENTENCE, hasRunner } from '../src/CollectionMembers'
import { button, click, render, settle, type } from './dom'
import { fakeApi, person } from './fakeApi'

const people = [person('p1', 'Ana Morales'), person('p2', 'Luis Park'), person('p3', 'Priya Nair')]

const members = async (runner: boolean) => {
  const { api, calls } = fakeApi({
    people,
    collections: [{
      bucket: 'sparcd-aaa',
      uuid: 'aaa',
      name: 'Sky Islands 2026',
      organization: 'Sky Island Alliance',
      members: [
        { personId: 'p1', name: 'Ana Morales', access: runner ? 'run' : 'upload', exactLocations: true },
        { personId: 'p2', name: 'Luis Park', access: 'identify', exactLocations: false },
      ],
    }],
  })
  const view = render(<CollectionMembers api={api} bucket="sparcd-aaa" people={people} />)
  await settle()
  return { view, calls }
}

const radio = (host: HTMLElement, label: string) => host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement

afterEach(() => { document.body.innerHTML = '' })

describe('who runs the collection', () => {
  it('names the runners', async () => {
    const { view } = await members(true)
    expect(view.host.textContent).toContain('Run by: Ana Morales')
    expect(view.host.textContent).not.toContain('Run by: nobody yet')
  })

  it('says nobody yet and blocks the save when the last runner is taken away', async () => {
    const { view, calls } = await members(true)
    await click(radio(view.host, 'Can upload for Ana Morales'))
    expect(view.host.textContent).toContain('Run by: nobody yet')
    expect(view.host.textContent).toContain(RUNNER_SENTENCE)

    await click(button(view.host, 'Save people'))
    expect(calls.some((call) => call.name === 'setMembers')).toBe(false)
    expect(view.host.textContent).toContain(RUNNER_SENTENCE)
  })

  it('saves once somebody runs it', async () => {
    const { view, calls } = await members(false)
    expect(view.host.textContent).toContain('Run by: nobody yet')
    await click(radio(view.host, 'Runs this collection for Luis Park'))
    await click(button(view.host, 'Save people'))
    await settle()
    const sent = calls.find((call) => call.name === 'setMembers')!
    expect(sent.args[0]).toBe('sparcd-aaa')
    expect(sent.args[1]).toEqual([
      { personId: 'p1', access: 'upload', exactLocations: true },
      { personId: 'p2', access: 'run', exactLocations: false },
    ])
    expect(view.host.textContent).toContain('Saved.')
  })

  it('knows the rule without a screen', () => {
    expect(hasRunner([{ access: 'upload' }, { access: 'run' }])).toBe(true)
    expect(hasRunner([{ access: 'upload' }])).toBe(false)
  })
})

describe('changing the table', () => {
  it('keeps the save disabled until something moves', async () => {
    const { view } = await members(true)
    expect((button(view.host, 'Save people') as HTMLButtonElement).disabled).toBe(true)
    await click(view.host.querySelector('input[aria-label="Sees exact camera locations for Luis Park"]')!)
    expect((button(view.host, 'Save people') as HTMLButtonElement).disabled).toBe(false)
  })

  it('adds a person by search and drops one with Remove', async () => {
    const { view } = await members(true)
    await type(view.host.querySelector('#add-person-sparcd-aaa') as HTMLInputElement, 'Priya')
    await click(button(view.host, 'Priya Nair'))
    expect(view.host.textContent).toContain('Priya Nair')

    const removes = Array.from(view.host.querySelectorAll('button')).filter((one) => one.textContent === 'Remove')
    await click(removes[0])
    expect(view.host.textContent).not.toContain('Ana Morales')
  })
})
