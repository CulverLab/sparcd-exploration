// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { CollectionMembers, RUNNER_SENTENCE, hasRunner } from '../src/CollectionMembers'
import { button, click, hasButton, render, settle, type } from './dom'
import { fakeApi, person } from './fakeApi'
import type { AccessApi } from '../src/api'

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
      membersVersion: 'members-v1',
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
    expect(sent.args[2]).toBe('members-v1')
    expect(view.host.textContent).toContain('Saved.')
  })

  it('knows the rule without a screen', () => {
    expect(hasRunner([{ access: 'upload' }, { access: 'run' }])).toBe(true)
    expect(hasRunner([{ access: 'upload' }])).toBe(false)
  })
})

describe('two coordinators at once', () => {
  it('sends the version it read and says who moved first', async () => {
    const { api, calls, data } = fakeApi({
      people,
      collections: [{
        bucket: 'sparcd-aaa', uuid: 'aaa', name: 'Sky Islands 2026', organization: 'Sky Island Alliance',
        members: [{ personId: 'p1', name: 'Ana Morales', access: 'run', exactLocations: false }],
        membersVersion: 'members-v1',
      }],
    })
    const view = render(<CollectionMembers api={api} bucket="sparcd-aaa" people={people} />)
    await settle()

    data.collections[0].membersVersion = 'members-v7'
    await click(radio(view.host, 'Can upload for Ana Morales'))
    await click(radio(view.host, 'Runs this collection for Ana Morales'))
    await click(view.host.querySelector('input[aria-label="Sees exact camera locations for Ana Morales"]')!)
    await click(button(view.host, 'Save people'))
    await settle()

    expect(calls.find((call) => call.name === 'setMembers')!.args[2]).toBe('members-v1')
    expect(view.host.textContent).toContain('Someone else changed this. Reload and try again.')
  })
})

describe('a read that started before a save', () => {
  it('never replaces what the save wrote', async () => {
    const collection = (bucket: string, uuid: string, runner: string) => ({
      bucket, uuid, name: bucket, organization: 'Sky Island Alliance',
      members: [
        { personId: 'p1', name: 'Ana Morales', access: (runner === 'p1' ? 'run' : 'upload') as 'run' | 'upload', exactLocations: true },
        { personId: 'p2', name: 'Luis Park', access: 'identify' as const, exactLocations: false },
      ],
      membersVersion: `${uuid}-v1`,
    })
    const { api, calls } = fakeApi({ people, collections: [collection('sparcd-aaa', 'aaa', 'p1'), collection('sparcd-bbb', 'bbb', 'p1')] })
    let slow: (() => void) | null = null
    let holding = false
    const answer = api.listCollectionAccess.bind(api)
    api.listCollectionAccess = async () => {
      const answered = structuredClone(await answer())
      if (holding) {
        holding = false
        await new Promise<void>((resolve) => { slow = resolve })
      }
      return answered
    }

    const view = render(<CollectionMembers api={api} bucket="sparcd-aaa" people={people} />)
    await settle()
    // Reading the other collection takes its time; coming back is quick.
    holding = true
    view.rerender(<CollectionMembers api={api} bucket="sparcd-bbb" people={people} />)
    await settle()
    view.rerender(<CollectionMembers api={api} bucket="sparcd-aaa" people={people} />)
    await settle()

    await click(radio(view.host, 'Runs this collection for Luis Park'))
    await click(button(view.host, 'Save people'))
    await settle()
    expect(view.host.textContent).toContain('Saved.')

    await act(async () => { slow!() })
    await settle()

    expect(radio(view.host, 'Runs this collection for Luis Park').checked).toBe(true)
    expect((button(view.host, 'Save people') as HTMLButtonElement).disabled).toBe(true)

    // And the next save goes out against the version that save came back with.
    await click(view.host.querySelector('input[aria-label="Sees exact camera locations for Luis Park"]')!)
    await click(button(view.host, 'Save people'))
    await settle()
    expect(view.host.textContent).not.toContain('Someone else changed this.')
    expect(calls.filter((call) => call.name === 'setMembers')).toHaveLength(2)
  })
})

describe('switching to another collection', () => {
  // Two collections whose member lists differ, and a read that can be held
  // open so the switch can be inspected mid-flight.
  const two = () => {
    const collection = (bucket: string, uuid: string, runner: string) => ({
      bucket, uuid, name: bucket, organization: 'Sky Island Alliance',
      members: [
        { personId: 'p1', name: 'Ana Morales', access: (runner === 'p1' ? 'run' : 'upload') as 'run' | 'upload', exactLocations: true },
        { personId: 'p2', name: 'Luis Park', access: (runner === 'p2' ? 'run' : 'identify') as 'run' | 'identify', exactLocations: false },
      ],
      membersVersion: `${uuid}-v1`,
    })
    const made = fakeApi({ people, collections: [collection('sparcd-aaa', 'aaa', 'p1'), collection('sparcd-bbb', 'bbb', 'p2')] })
    const api = made.api as AccessApi & { listCollectionAccess: () => Promise<unknown> }
    const answer = api.listCollectionAccess.bind(api)
    const gates: (() => void)[] = []
    let holdNext = false
    api.listCollectionAccess = async () => {
      const answered = structuredClone(await answer())
      if (holdNext) {
        holdNext = false
        await new Promise<void>((resolve) => { gates.push(resolve) })
      }
      return answered
    }
    return { ...made, hold: () => { holdNext = true }, release: () => act(async () => { gates.shift()!() }) }
  }

  it('shows nothing editable until the other list of people arrives', async () => {
    const { api, calls, hold, release } = two()
    const view = render(<CollectionMembers api={api} bucket="sparcd-aaa" people={people} />)
    await settle()
    expect(radio(view.host, 'Runs this collection for Ana Morales').checked).toBe(true)

    hold()
    view.rerender(<CollectionMembers api={api} bucket="sparcd-bbb" people={people} />)
    await settle()

    expect(view.host.textContent).toContain('Loading people…')
    expect(view.host.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    expect(hasButton(view.host, 'Save people')).toBe(false)

    await release()
    await settle()
    // Now it is the other collection's list, with its own runner.
    expect(radio(view.host, 'Runs this collection for Luis Park').checked).toBe(true)

    await click(radio(view.host, 'Sees exact camera locations for Luis Park'))
    await click(button(view.host, 'Save people'))
    await settle()
    const sent = calls.find((call) => call.name === 'setMembers')!
    expect(sent.args[0]).toBe('sparcd-bbb')
    expect(sent.args[2]).toBe('bbb-v1')
    expect(sent.args[1]).toEqual([
      { personId: 'p1', access: 'upload', exactLocations: true },
      { personId: 'p2', access: 'run', exactLocations: true },
    ])
  })

  it('drops an answer for the collection it left', async () => {
    const { api, hold, release } = two()
    hold()
    const view = render(<CollectionMembers api={api} bucket="sparcd-aaa" people={people} />)
    await settle()

    view.rerender(<CollectionMembers api={api} bucket="sparcd-bbb" people={people} />)
    await settle()
    expect(radio(view.host, 'Runs this collection for Luis Park').checked).toBe(true)

    await release()
    await settle()
    expect(radio(view.host, 'Runs this collection for Luis Park').checked).toBe(true)
    expect(radio(view.host, 'Runs this collection for Ana Morales').checked).toBe(false)
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
