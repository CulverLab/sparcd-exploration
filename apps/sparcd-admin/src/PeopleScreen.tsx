import { useEffect, useState } from 'react'
import type { Access, AccessApi, Invite, Person } from './api'
import { AccessChoices, membershipSentence } from './AccessChoices'
import { AddPerson } from './AddPerson'
import { InviteLink, inviteLink } from './InviteLink'

export function lastActiveText(when: string | null | undefined, now = new Date()) {
  if (!when) return 'Not yet'
  const then = new Date(when)
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(then).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate())

export function collectionsText(person: Person) {
  const names = person.collections.map((entry) => entry.name ?? entry.bucket)
  if (names.length === 0) return 'None yet'
  if (names.length <= 2) return names.join(', ')
  return `${names.length} collections`
}

const statusWord: Record<Person['status'], string> = { active: 'Active', invited: 'Invited', paused: 'Paused' }

function StatusPill({ status }: { status: Person['status'] }) {
  const tone = status === 'active' ? 'border-ok text-ok' : status === 'paused' ? 'border-warn text-warn' : 'border-rule text-inkSoft'
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-xs ${tone}`}>
      <span aria-hidden className="text-[7px] leading-none">●</span>
      {statusWord[status]}
    </span>
  )
}

type Confirm = 'pause' | 'resume' | 'reset' | null

export function PeopleScreen({ api, endpoint, collections, from }: {
  api: AccessApi
  endpoint: string
  collections: { bucket: string; name: string }[]
  from: string
}) {
  const [people, setPeople] = useState<Person[] | null>(null)
  const [problem, setProblem] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [invite, setInvite] = useState<{ person: Person; invite: Invite } | null>(null)
  const [addTo, setAddTo] = useState<{ bucket: string; access: Access; exactLocations: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = async () => {
    try {
      setPeople(await api.listPeople())
      setProblem('')
    } catch (cause) {
      setProblem((cause as Error).message)
    }
  }

  useEffect(() => { void refresh() }, [])

  const selected = people?.find((person) => person.id === selectedId) ?? null

  const act = async (run: () => Promise<void>) => {
    setBusy(true)
    setProblem('')
    try {
      await run()
      await refresh()
    } catch (cause) {
      setProblem((cause as Error).message)
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const pause = (person: Person, paused: boolean) =>
    act(async () => { await api.updatePerson(person.id, { status: paused ? 'paused' : 'active' }) })

  const reset = (person: Person) =>
    act(async () => { setInvite({ person, invite: await api.resetPerson(person.id) }) })

  const addToCollection = (person: Person, bucket: string, access: Access, exactLocations: boolean) =>
    act(async () => {
      // There is no per-person endpoint: the whole member list goes back.
      const all = await api.listCollectionAccess()
      const target = all.find((entry) => entry.bucket === bucket)
      const members = (target?.members ?? [])
        .filter((member) => member.personId !== person.id)
        .map((member) => ({ personId: member.personId, access: member.access, exactLocations: member.exactLocations }))
      await api.setMembers(bucket, [...members, { personId: person.id, access, exactLocations }])
      setAddTo(null)
    })

  const needle = search.trim().toLocaleLowerCase()
  const visible = (people ?? []).filter((person) =>
    !needle || `${person.name} ${person.email}`.toLocaleLowerCase().includes(needle))

  const inputClass = 'min-h-10 border border-rule bg-paper px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
  const plainButton = 'border border-rule px-3 py-2 text-sm text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

  return (
    <section className="border border-rule bg-panel" aria-labelledby="people-heading">
      <div className="border-b border-rule px-4 py-3">
        <h1 id="people-heading" className="m-0 text-lg font-semibold text-ink">People</h1>
        <p className="mb-0 mt-1 text-sm text-inkSoft">Everyone who can sign in, and what they can do.</p>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="people-search">Search people</label>
            <input
              id="people-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search people by name or email"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="button" onClick={() => { setAdding(true); setSelectedId(null) }} className="shrink-0 border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              Add a person
            </button>
          </div>
          {people === null && !problem && <p className="mt-3 text-sm text-inkSoft">Loading people…</p>}
          {people !== null && (
            <>
              <p className="mb-0 mt-2 text-sm text-inkSoft">{people.length} {people.length === 1 ? 'person' : 'people'}</p>
              <ul className="mt-2 list-none border border-ruleSoft p-0">
                {visible.map((person) => (
                  <li key={person.id} className="border-b border-ruleSoft last:border-b-0">
                    <button
                      type="button"
                      onClick={() => { setSelectedId(person.id); setAdding(false); setConfirm(null); setInvite(null); setAddTo(null) }}
                      aria-current={person.id === selectedId ? 'true' : undefined}
                      className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 -outline-offset-2 focus-visible:outline-accent ${
                        person.id === selectedId ? 'bg-accentSoft' : 'hover:bg-paperHover'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate text-ink">{person.name}</span>
                      <StatusPill status={person.status} />
                      <span className="hidden w-40 shrink-0 truncate text-xs text-inkSoft sm:block">{collectionsText(person)}</span>
                      <span className="w-20 shrink-0 text-right text-xs text-inkSoft">{lastActiveText(person.lastActiveAt)}</span>
                    </button>
                  </li>
                ))}
                {visible.length === 0 && <li className="px-3 py-2 text-sm text-inkSoft">Nobody matches that search.</li>}
              </ul>
            </>
          )}
          {problem && <p role="alert" className="mt-3 text-sm text-warn">{problem}</p>}
          {adding && (
            <AddPerson
              api={api}
              endpoint={endpoint}
              collections={collections}
              from={from}
              onAdded={() => void refresh()}
              onClose={() => setAdding(false)}
            />
          )}
        </div>

        {selected && (
          <div className="min-w-0 border border-rule bg-paper p-4">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="m-0 text-base font-semibold text-ink">{selected.name}</h2>
                <p className="m-0 text-sm text-inkSoft">{selected.email}</p>
              </div>
              <StatusPill status={selected.status} />
            </div>

            <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-inkSoft">Access</h3>
            {selected.collections.length === 0
              ? <p className="m-0 text-sm text-inkSoft">Not in any collection yet.</p>
              : <ul className="m-0 list-none p-0">
                  {selected.collections.map((membership) => (
                    <li key={membership.bucket} className="py-0.5 text-sm text-ink">{membershipSentence(membership)}</li>
                  ))}
                </ul>}
            {addTo ? (
              <div className="mt-2">
                <label className="grid gap-1 text-sm font-medium text-ink">
                  Collection
                  <select
                    aria-label="Collection"
                    className={inputClass}
                    value={addTo.bucket}
                    onChange={(event) => setAddTo({ ...addTo, bucket: event.target.value })}
                  >
                    {collections.map((entry) => <option key={entry.bucket} value={entry.bucket}>{entry.name}</option>)}
                  </select>
                </label>
                <div className="mt-2">
                  <AccessChoices
                    name="add-to-collection-access"
                    value={addTo.access}
                    onChange={(access) => setAddTo({ ...addTo, access })}
                    exactLocations={addTo.exactLocations}
                    onExactLocations={(exactLocations) => setAddTo({ ...addTo, exactLocations })}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !addTo.bucket} onClick={() => void addToCollection(selected, addTo.bucket, addTo.access, addTo.exactLocations)} className="border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper disabled:opacity-40">Add to collection</button>
                  <button type="button" onClick={() => setAddTo(null)} className={plainButton}>Cancel</button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddTo({ bucket: collections[0]?.bucket ?? '', access: 'identify', exactLocations: false })}
                className={`mt-2 ${plainButton}`}
              >
                Add to a collection
              </button>
            )}

            <h3 className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-inkSoft">If something's wrong</h3>
            {confirm === 'reset' ? (
              <div className="border border-warn p-3">
                <p className="m-0 text-sm text-ink">Reset {selected.name}'s access? Their current sign-in stops working straight away.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void reset(selected)} className="border border-warn px-3 py-2 text-sm text-warn">Yes, reset access</button>
                  <button type="button" onClick={() => setConfirm(null)} className={plainButton}>Cancel</button>
                </div>
              </div>
            ) : (
              <>
                <button type="button" onClick={() => setConfirm('reset')} className="border border-warn px-3 py-2 text-sm text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Reset access</button>
                <p className="mb-0 mt-1 text-sm text-inkSoft">Use this if their laptop was lost. Their current sign-in stops working and you get a new invite link to send them.</p>
              </>
            )}
            {invite?.person.id === selected.id && (
              <InviteLink name={selected.name} email={selected.email} link={inviteLink(endpoint, invite.invite.token)} from={from} />
            )}

            {confirm === 'pause' || confirm === 'resume' ? (
              <div className="mt-3 border border-warn p-3">
                <p className="m-0 text-sm text-ink">
                  {confirm === 'pause'
                    ? `Pause ${selected.name}'s access? They keep their collections but can't sign in until you resume.`
                    : `Let ${selected.name} sign in again?`}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void pause(selected, confirm === 'pause')} className="border border-warn px-3 py-2 text-sm text-warn">
                    {confirm === 'pause' ? 'Yes, pause access' : 'Yes, resume access'}
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} className={plainButton}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-3">
                <button type="button" onClick={() => setConfirm(selected.status === 'paused' ? 'resume' : 'pause')} className={plainButton}>
                  {selected.status === 'paused' ? 'Resume access' : 'Pause access'}
                </button>
                <p className="mb-0 mt-1 text-sm text-inkSoft">
                  {selected.status === 'paused'
                    ? 'They can sign in again with the link they already have.'
                    : 'They keep their collections but can\'t sign in until you resume.'}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
