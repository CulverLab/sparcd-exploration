import { useEffect, useState } from 'react'
import { ApiError, problemSentence, type AccessApi, type Invite, type Person } from './api'
import { AccessCells, AccessHeadings, WILL_BE_REMOVED, type AccessRow } from './AccessChoices'
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

const NOT_A_MEMBER: AccessRow = { access: [], exactLocations: false }

const sameRow = (a: AccessRow, b: AccessRow) =>
  a.access.join() === b.access.join() && a.exactLocations === b.exactLocations

/** Every collection, then any the person belongs to that the list does not name. */
export function collectionRows(collections: { bucket: string; name: string }[], person: Person) {
  const rows = collections.map((entry) => ({ bucket: entry.bucket, name: entry.name }))
  for (const membership of person.collections) {
    if (!rows.some((row) => row.bucket === membership.bucket)) {
      rows.push({ bucket: membership.bucket, name: membership.name ?? membership.bucket })
    }
  }
  return rows
}

export function PeopleScreen({ api, people, refresh, endpoint, collections, from }: {
  api: AccessApi
  /** The one list the app holds; the members table reads the same one. */
  people: Person[] | null
  refresh: () => Promise<void>
  endpoint: string
  collections: { bucket: string; name: string }[]
  from: string
}) {
  const [problem, setProblem] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [invite, setInvite] = useState<{ person: Person; invite: Invite } | null>(null)
  // Rows the admin has changed and not saved yet, by bucket.
  const [draft, setDraft] = useState<Record<string, AccessRow>>({})
  const [busy, setBusy] = useState(false)

  const reload = async () => {
    try {
      await refresh()
      setProblem('')
    } catch (cause) {
      setProblem(problemSentence(cause))
    }
  }

  useEffect(() => { void reload() }, [])

  const selected = people?.find((person) => person.id === selectedId) ?? null

  const act = async (run: () => Promise<void>, lastRunner?: string) => {
    setBusy(true)
    setProblem('')
    try {
      await run()
      await refresh()
    } catch (cause) {
      setProblem(lastRunner && cause instanceof ApiError && cause.code === 'last_runner' ? lastRunner : problemSentence(cause))
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const soleRunner = (person: Person) =>
    `${person.name} is the only person running one of their collections. Have someone else run it first.`

  const pause = (person: Person, paused: boolean) =>
    act(async () => { await api.updatePerson(person.id, { status: paused ? 'paused' : 'active' }) }, soleRunner(person))

  const reset = (person: Person) =>
    act(async () => { setInvite({ person, invite: await api.resetPerson(person.id) }) }, soleRunner(person))

  const savedRow = (person: Person, bucket: string): AccessRow => {
    const membership = person.collections.find((entry) => entry.bucket === bucket)
    return membership ? { access: membership.access, exactLocations: membership.exactLocations } : NOT_A_MEMBER
  }
  const shownRow = (person: Person, bucket: string) => draft[bucket] ?? savedRow(person, bucket)
  const isMember = (person: Person, bucket: string) => person.collections.some((entry) => entry.bucket === bucket)

  /** A row with nothing ticked is not a member; it only needs a write if it was one. */
  const needsWrite = (person: Person, bucket: string) => {
    const next = shownRow(person, bucket)
    if (next.access.length === 0) return isMember(person, bucket)
    return !isMember(person, bucket) || !sameRow(next, savedRow(person, bucket))
  }

  // One membership at a time: the service owns each member list, so nothing
  // here has to read it, rewrite it, and race whoever else is editing it.
  const saveAccess = (person: Person, buckets: string[]) =>
    act(async () => {
      try {
        for (const bucket of buckets) {
          const next = shownRow(person, bucket)
          if (next.access.length === 0) await api.removeMember(bucket, person.id)
          else await api.setMember(bucket, person.id, next)
        }
      } catch (cause) {
        // Whatever landed before the failure shows as saved; the rest stays ticked.
        await refresh().catch(() => {})
        throw cause
      }
      setDraft({})
    })

  const needle = search.trim().toLocaleLowerCase()
  const visible = (people ?? []).filter((person) =>
    !needle || `${person.name} ${person.email}`.toLocaleLowerCase().includes(needle))

  const accessRows = selected ? collectionRows(collections, selected) : []
  const pending = selected ? accessRows.filter((row) => needsWrite(selected, row.bucket)).map((row) => row.bucket) : []

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
                      onClick={() => { setSelectedId(person.id); setAdding(false); setConfirm(null); setInvite(null); setDraft({}) }}
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
              onAdded={() => void reload()}
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
            {accessRows.length === 0
              ? <p className="m-0 text-sm text-inkSoft">There are no collections yet.</p>
              : <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <AccessHeadings first="Collection" />
                    </thead>
                    <tbody>
                      {accessRows.map((row) => {
                        const leaving = isMember(selected, row.bucket) && shownRow(selected, row.bucket).access.length === 0
                        return (
                          <tr key={row.bucket} className="border-t border-ruleSoft">
                            <td className={`py-2 pr-3 ${leaving ? 'text-inkSoft' : 'text-ink'}`}>{row.name}</td>
                            <AccessCells
                              label={row.name}
                              row={shownRow(selected, row.bucket)}
                              disabled={busy}
                              onChange={(next) => setDraft({ ...draft, [row.bucket]: next })}
                            />
                            <td className="py-2 text-right text-sm text-inkSoft">{leaving ? WILL_BE_REMOVED : ''}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>}
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy || pending.length === 0} onClick={() => void saveAccess(selected, pending)} className="border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-40">
                Save access
              </button>
              <button type="button" disabled={busy || pending.length === 0} onClick={() => setDraft({})} className={`${plainButton} disabled:cursor-not-allowed disabled:opacity-40`}>Undo changes</button>
            </div>

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
