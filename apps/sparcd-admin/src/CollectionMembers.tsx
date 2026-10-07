import { useEffect, useRef, useState } from 'react'
import { problemSentence, type Access, type AccessApi, type Person } from './api'
import { ACCESS_CHOICES, EXACT_LOCATIONS } from './AccessChoices'
import { moment } from './moment'

type Row = { personId: string; name: string; access: Access; exactLocations: boolean }

/** One collection's people. The rows carry the bucket they were read from. */
type Table = { bucket: string; rows: Row[]; saved: Row[]; version: string | null }

export const RUNNER_SENTENCE = 'A collection always needs at least one person running it.'

export const hasRunner = (rows: { access: Access }[]) => rows.some((row) => row.access === 'run')

export function CollectionMembers({ api, bucket, people }: {
  api: AccessApi
  bucket: string
  people: Person[]
}) {
  const [table, setTable] = useState<Table | null>(null)
  const [search, setSearch] = useState('')
  const [problem, setProblem] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // When this table last wrote its people. A read taken before that moment is
  // older than what the write produced, however late it arrives.
  const wroteAt = useRef(0)
  // The collection the table is meant to be showing, so an answer for the one
  // it left can be dropped instead of landing on the current rows.
  const wanted = useRef(bucket)

  const nameOf = (personId: string) => people.find((person) => person.id === personId)?.name ?? personId

  const load = async (forBucket: string) => {
    const startedAt = moment()
    try {
      const all = await api.listCollectionAccess()
      if (forBucket !== wanted.current || startedAt < wroteAt.current) return
      const here = all.find((entry) => entry.bucket === forBucket)
      const loaded: Row[] = (here?.members ?? []).map((member) => ({
        personId: member.personId,
        name: member.name ?? nameOf(member.personId),
        access: member.access,
        exactLocations: member.exactLocations,
      }))
      setTable({ bucket: forBucket, rows: loaded, saved: loaded, version: here?.membersVersion ?? null })
      setProblem('')
    } catch (cause) {
      if (forBucket !== wanted.current) return
      setProblem(problemSentence(cause))
    }
  }

  // A switch drops the whole table at once. Rows, version and draft belong to
  // one collection; keeping any of them across a switch would write one
  // collection's people over another's.
  useEffect(() => {
    wanted.current = bucket
    setTable(null)
    setProblem('')
    setMessage('')
    void load(bucket)
  }, [bucket])

  if (problem) return <p role="alert" className="mt-4 text-sm text-warn">{problem}</p>
  if (!table || table.bucket !== bucket) return <p className="mt-4 text-sm text-inkSoft">Loading people…</p>

  const { rows, saved, version } = table
  const setRows = (next: Row[]) => setTable({ ...table, rows: next })
  const changed = JSON.stringify(rows) !== JSON.stringify(saved)
  const runners = rows.filter((row) => row.access === 'run')

  const set = (personId: string, patch: Partial<Row>) =>
    setRows(rows.map((row) => (row.personId === personId ? { ...row, ...patch } : row)))

  const save = async () => {
    // The rows carry the collection they were read from. Writing them anywhere
    // else would overwrite who can reach that other collection.
    if (table.bucket !== bucket) return
    if (!hasRunner(rows)) {
      setMessage(RUNNER_SENTENCE)
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const written = await api.setMembers(
        table.bucket,
        rows.map(({ personId, access, exactLocations }) => ({ personId, access, exactLocations })),
        version,
      )
      wroteAt.current = moment()
      setTable((current) =>
        current && current.bucket === table.bucket
          ? { ...current, saved: rows, version: written.membersVersion }
          : current)
      setMessage('Saved.')
    } catch (cause) {
      setMessage(problemSentence(cause))
    } finally {
      setBusy(false)
    }
  }

  const needle = search.trim().toLocaleLowerCase()
  const candidates = needle
    ? people.filter((person) =>
        !rows.some((row) => row.personId === person.id) &&
        `${person.name} ${person.email}`.toLocaleLowerCase().includes(needle))
    : []

  return (
    <section className="mt-4 border border-rule" aria-labelledby={`members-${bucket}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
        <h3 id={`members-${bucket}`} className="m-0 flex-1 text-sm font-semibold text-ink">People in this collection</h3>
        {runners.length > 0
          ? <p className="m-0 text-sm text-inkSoft">Run by: {runners.map((row) => row.name).join(', ')}</p>
          : <p className="m-0 text-sm text-warn">Run by: nobody yet</p>}
      </div>
      {runners.length === 0 && <p className="m-0 border-b border-rule px-4 py-2 text-sm text-warn">{RUNNER_SENTENCE}</p>}
      <div className="overflow-x-auto p-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-inkSoft">
              <th className="py-2 pr-3 font-semibold">Person</th>
              {ACCESS_CHOICES.map((choice) => <th key={choice.value} className="px-2 py-2 font-semibold">{choice.label}</th>)}
              <th className="px-2 py-2 font-semibold">{EXACT_LOCATIONS.label}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.personId} className="border-t border-ruleSoft">
                <td className="py-2 pr-3 text-ink">{row.name}</td>
                {ACCESS_CHOICES.map((choice) => (
                  <td key={choice.value} className="px-2 py-2 text-center">
                    <input
                      type="radio"
                      disabled={busy}
                      name={`access-${bucket}-${row.personId}`}
                      aria-label={`${choice.label} for ${row.name}`}
                      className="h-4 w-4 accent-accent"
                      checked={row.access === choice.value}
                      onChange={() => set(row.personId, { access: choice.value })}
                    />
                  </td>
                ))}
                <td className="px-2 py-2 text-center">
                  <input
                    type="checkbox"
                    disabled={busy}
                    aria-label={`${EXACT_LOCATIONS.label} for ${row.name}`}
                    className="h-4 w-4 accent-accent"
                    checked={row.exactLocations}
                    onChange={(event) => set(row.personId, { exactLocations: event.target.checked })}
                  />
                </td>
                <td className="py-2 text-right">
                  <button type="button" disabled={busy} className="text-sm text-ink underline disabled:opacity-40" onClick={() => setRows(rows.filter((other) => other.personId !== row.personId))}>Remove</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="py-2 text-inkSoft">Nobody is in this collection yet.</td></tr>}
          </tbody>
        </table>

        <label className="mt-3 block text-sm font-medium text-ink" htmlFor={`add-person-${bucket}`}>Add a person to this collection</label>
        <input
          id={`add-person-${bucket}`}
          disabled={busy}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people"
          className="mt-1 min-h-10 w-full max-w-sm border border-rule bg-paper px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
        {candidates.length > 0 && (
          <ul className="mt-1 max-w-sm list-none border border-rule bg-paper p-0">
            {candidates.map((person) => (
              <li key={person.id}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-paperHover"
                  onClick={() => {
                    setRows([...rows, { personId: person.id, name: person.name, access: 'identify', exactLocations: false }])
                    setSearch('')
                  }}
                >
                  {person.name}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!changed || busy}
            onClick={() => void save()}
            className="border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {busy ? 'Saving…' : 'Save people'}
          </button>
          {message && <p role="status" className="m-0 text-sm text-inkSoft">{message}</p>}
        </div>
      </div>
    </section>
  )
}
