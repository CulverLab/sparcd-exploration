// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { AssignmentChecklist, type Kind } from '../src/AssignmentChecklist'
import { RegistryEditor, type Registry } from '../src/RegistryEditor'
import { render } from './dom'
import { recordingClient } from './fake'

const registry = (kind: 'Species' | 'Locations'): Registry => ({
  key: `Settings/${kind.toLowerCase()}.json`,
  bucket: 'sparcd-settings-a',
  etag: 'v1',
  value: [],
})

const checklist = (kind: Kind) => (
  <AssignmentChecklist
    key={kind}
    kind={kind}
    used={[]}
    shared={[]}
    search=""
    onSearch={() => {}}
    onChange={() => {}}
    onUndo={() => {}}
    canUndo={false}
    onSave={() => {}}
    changed={false}
    outdated={[]}
    onUpdateAll={() => {}}
    onUpdateOne={() => {}}
  />
)

afterEach(() => { document.body.innerHTML = '' })

describe('element ids on a page that repeats a component', () => {
  it('gives every search box its own id', () => {
    const { client } = recordingClient({ existing: {} })
    const { host } = render(
      <>
        <RegistryEditor title="Species" registry={registry('Species')} client={client} actor="admin" reload={() => {}} />
        <RegistryEditor title="Locations" registry={registry('Locations')} client={client} actor="admin" reload={() => {}} />
        {checklist('species')}
        {checklist('locations')}
      </>,
    )
    const ids = Array.from(host.querySelectorAll('[id]')).map((one) => one.id)
    expect(ids).toHaveLength(new Set(ids).size)
    // Every search box is still reachable by its label.
    const labelled = Array.from(host.querySelectorAll('label[for]'))
      .filter((one) => one.textContent?.startsWith('Search '))
    expect(labelled).toHaveLength(4)
    for (const label of labelled) {
      expect(document.getElementById(label.getAttribute('for')!)).not.toBeNull()
    }
  })
})
