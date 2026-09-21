import { useEffect, useState } from 'react'
import { ConditionalReplaceConflictError, type CollectionRef, type SafeS3Client } from '@sparcd/s3-safe'
import { AssignmentChecklist, matchShared, sharedHasId, type Entry, type Kind } from './AssignmentChecklist'

export type CollectionAssignment = { values: unknown[]; etag: string | null }
export type CollectionRecord = CollectionRef & {
  etag: string
  document: Record<string, unknown>
  speciesAssignment: CollectionAssignment
  locationsAssignment: CollectionAssignment
}

export type Discrepancy = { index: number; current: Entry; truth: Entry }

const fields = [
  ['nameProperty', 'Name'],
  ['organizationProperty', 'Organization'],
  ['contactInfoProperty', 'Contact'],
  ['descriptionProperty', 'Description'],
] as const
const requiredFields = new Set<string>(['nameProperty', 'organizationProperty', 'descriptionProperty'])

const json = (value: unknown) => JSON.stringify(value, null, 2)
const asJson = { contentType: 'application/json' }

const withoutId = (kind: Kind, entry: Entry) => {
  const copy = { ...entry }
  delete copy[kind === 'species' ? 'scientificName' : 'idProperty']
  return copy
}

export function makeAppliedAuditRetry(
  client: SafeS3Client,
  bucket: string,
  key: string,
  event: Record<string, unknown>,
  afterETag?: string,
) {
  return () =>
    client.writeImmutable(bucket, key, json({ ...event, appliedAt: new Date().toISOString(), afterETag }), asJson)
}

/** Entries this collection uses whose shared-list record has since changed. */
export function assignmentDiscrepancies(kind: Kind, used: unknown[], shared: unknown[]): Discrepancy[] {
  return (used as Entry[]).flatMap((current, index) => {
    const truth = matchShared(kind, current, shared as Entry[])
    if (!truth || JSON.stringify(withoutId(kind, current)) === JSON.stringify(withoutId(kind, truth))) return []
    return [{ index, current, truth }]
  })
}

/** Entries this collection uses that the shared list no longer holds at all. */
export function missingAssignments(kind: Kind, used: unknown[], shared: unknown[]) {
  return (used as Entry[]).filter((entry) => !sharedHasId(kind, entry, shared as Entry[]))
}

export function assignmentLabel(kind: Kind, entry: Entry) {
  return String(entry[kind === 'species' ? 'name' : 'nameProperty'] ?? entry[kind === 'species' ? 'scientificName' : 'idProperty'] ?? 'Unnamed')
}

export function assignmentHasMinimum(values: unknown[]) {
  return values.length > 0
}

export function collectionValidationError(collection: Record<string, unknown>) {
  const missing = fields.find(([key]) => requiredFields.has(key) && String(collection[key] ?? '').trim() === '')
  return missing ? `${missing[1]} is required.` : null
}

export function collectionHasChanges(draft: Record<string, unknown>, saved: Record<string, unknown>) {
  return JSON.stringify(draft) !== JSON.stringify(saved)
}

type Editing = {
  key: string
  draft: Record<string, unknown>
  used: Record<Kind, unknown[]>
  etags: { collection: string; species: string | null; locations: string | null }
  undo: Record<Kind, unknown[] | null>
}

// Everything held about one collection resets together. Keeping the version
// tags or the undo buffer across a switch would apply them to the next
// collection's files.
const editingFor = (record: CollectionRecord | undefined): Editing => ({
  key: record?.key ?? '',
  draft: record?.document ?? {},
  used: { species: record?.speciesAssignment.values ?? [], locations: record?.locationsAssignment.values ?? [] },
  etags: {
    collection: record?.etag ?? '',
    species: record?.speciesAssignment.etag ?? null,
    locations: record?.locationsAssignment.etag ?? null,
  },
  undo: { species: null, locations: null },
})

export function CollectionEditor({ collections, client, actor, reload, speciesRegistry, locationsRegistry }: {
  collections: CollectionRecord[]
  client: SafeS3Client
  actor: string
  reload: () => void
  speciesRegistry: unknown[]
  locationsRegistry: unknown[]
}) {
  const [editing, setEditing] = useState<Editing>(() => editingFor(collections[0]))
  const [search, setSearch] = useState({ species: '', locations: '', collections: '' })
  const [message, setMessage] = useState('')
  const [retryApplied, setRetryApplied] = useState<(() => Promise<void>) | null>(null)

  useEffect(() => {
    setEditing((current) => editingFor(collections.find((entry) => entry.key === current.key) ?? collections[0]))
  }, [collections])

  const selected = collections.find((entry) => entry.key === editing.key) ?? null
  if (!selected) {
    return (
      <section className="border border-rule bg-panel p-4">
        <h1 className="m-0 text-lg font-semibold text-ink">Collections</h1>
        <p className="mb-0 mt-1 text-sm text-inkSoft">No collections are visible to this login.</p>
      </section>
    )
  }

  const sharedFor = (kind: Kind) => (kind === 'species' ? speciesRegistry : locationsRegistry)
  const outdated = {
    species: assignmentDiscrepancies('species', editing.used.species, speciesRegistry),
    locations: assignmentDiscrepancies('locations', editing.used.locations, locationsRegistry),
  }

  const selectCollection = (record: CollectionRecord) => {
    setEditing(editingFor(record))
    setRetryApplied(null)
    setMessage('')
  }

  const setUsed = (kind: Kind, next: unknown[]) =>
    setEditing((current) => ({
      ...current,
      used: { ...current.used, [kind]: next },
      undo: { ...current.undo, [kind]: current.used[kind] },
    }))

  // Undo restores without recording a new step, so the button disappears
  // instead of turning into a redo.
  const undoUsed = (kind: Kind) =>
    setEditing((current) => ({
      ...current,
      used: { ...current.used, [kind]: current.undo[kind] ?? current.used[kind] },
      undo: { ...current.undo, [kind]: null },
    }))

  const updateOne = (kind: Kind, at: number) =>
    setUsed(kind, editing.used[kind].map((entry, index) =>
      index === at ? outdated[kind].find((one) => one.index === at)?.truth ?? entry : entry))

  const updateAll = (kind: Kind) =>
    setUsed(kind, editing.used[kind].map((entry, index) =>
      outdated[kind].find((one) => one.index === index)?.truth ?? entry))

  const auditBase = () => {
    const eventId = crypto.randomUUID()
    const occurredAt = new Date().toISOString()
    return { eventId, occurredAt, base: `Settings/audit/config/${occurredAt.slice(0, 10)}/${eventId}` }
  }

  const finish = async (applied: () => Promise<void>, savedMessage: string) => {
    try {
      await applied()
      setRetryApplied(null)
      setMessage(savedMessage)
      reload()
    } catch {
      setRetryApplied(() => applied)
      setMessage('Saved. Its history entry did not go through.')
    }
  }

  const saveUsed = async (kind: Kind) => {
    const values = editing.used[kind]
    if (!values.length) {
      setMessage(`Keep at least one ${kind === 'species' ? 'species' : 'location'} in this collection.`)
      return
    }
    const key = `Collections/${selected.uuid}/${kind}.json`
    const { eventId, occurredAt, base } = auditBase()
    const event = {
      schemaVersion: 1,
      eventId,
      occurredAt,
      actor,
      action: `${kind}.assignment.updated`,
      target: { collectionKey: selected.key, key },
      before: selected[`${kind}Assignment`].values,
      after: values,
    }
    try {
      await client.writeImmutable(selected.bucket, `${base}.prepared.json`, json(event), asJson)
      const held = editing.etags[kind]
      let written: { etag?: string }
      if (held) {
        written = await client.replaceIfUnchanged(selected.bucket, key, json(values), { etag: held, ...asJson })
      } else {
        await client.writeImmutable(selected.bucket, key, json(values), asJson)
        written = await client.statObject(selected.bucket, key)
      }
      // The list is saved at this point. Hold its new version tag whatever the
      // history entry does next, or the following save reads as a conflict.
      setEditing((current) => ({ ...current, etags: { ...current.etags, [kind]: written.etag ?? null } }))
      await finish(
        makeAppliedAuditRetry(client, selected.bucket, `${base}.applied.json`, event, written.etag),
        `Saved the ${kind === 'species' ? 'species' : 'locations'} used in this collection.`,
      )
    } catch (cause) {
      setMessage(cause instanceof ConditionalReplaceConflictError
        ? 'Someone else changed this while you were editing. Reload before saving again.'
        : (cause as Error).message)
    }
  }

  const saveMetadata = async () => {
    const invalid = collectionValidationError(editing.draft)
    if (invalid) {
      setMessage(invalid)
      return
    }
    const { eventId, occurredAt, base } = auditBase()
    const event = {
      schemaVersion: 1,
      eventId,
      occurredAt,
      actor,
      action: 'collection.updated',
      target: { collectionKey: selected.key },
      before: selected.document,
      after: editing.draft,
    }
    try {
      await client.writeImmutable(selected.bucket, `${base}.prepared.json`, json(event), asJson)
      const written = await client.replaceIfUnchanged(
        selected.bucket,
        `Collections/${selected.uuid}/collection.json`,
        json(editing.draft),
        { etag: editing.etags.collection, ...asJson },
      )
      if (written.etag) {
        const next = written.etag
        setEditing((current) => ({ ...current, etags: { ...current.etags, collection: next } }))
      }
      await finish(
        makeAppliedAuditRetry(client, selected.bucket, `${base}.applied.json`, event, written.etag),
        'Saved.',
      )
    } catch (cause) {
      setMessage(cause instanceof ConditionalReplaceConflictError
        ? 'Someone else changed this collection while you were editing. Reload before saving again.'
        : (cause as Error).message)
    }
  }

  const needle = search.collections.trim().toLocaleLowerCase()
  const visible = needle
    ? collections.filter((entry) => `${entry.name ?? entry.bucket} ${entry.organization ?? ''}`.toLocaleLowerCase().includes(needle))
    : collections

  const inputClass = 'min-h-10 border border-rule bg-paper px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

  return (
    <section className="border border-rule bg-panel" aria-labelledby="collections-heading">
      <div className="border-b border-rule px-4 py-3">
        <h1 id="collections-heading" className="m-0 text-lg font-semibold text-ink">Collections</h1>
        <p className="mb-0 mt-1 text-sm text-inkSoft">Change a collection's details and the species and locations it uses. Its ID and where it is stored stay the same.</p>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="min-w-0">
          <label className="sr-only" htmlFor="collection-search">Search collections</label>
          <input
            id="collection-search"
            value={search.collections}
            onChange={(event) => setSearch((current) => ({ ...current, collections: event.target.value }))}
            placeholder="Search collections"
            className={`${inputClass} w-full`}
          />
          <ul className="mt-2 max-h-[32rem] list-none overflow-y-auto border border-ruleSoft p-0">
            {visible.map((entry) => (
              <li key={entry.key} className="border-b border-ruleSoft last:border-b-0">
                <button
                  type="button"
                  onClick={() => selectCollection(entry)}
                  aria-current={entry.key === editing.key ? 'true' : undefined}
                  className={`block w-full px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 -outline-offset-2 focus-visible:outline-accent ${
                    entry.key === editing.key ? 'bg-accentSoft' : 'hover:bg-paperHover'
                  }`}
                >
                  <span className="block truncate text-ink">{entry.name ?? entry.bucket}</span>
                  <span className="block truncate text-xs text-inkSoft">{entry.organization ?? 'No organization'}</span>
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-2 text-sm text-inkSoft">Nothing matches that search.</li>}
          </ul>
        </div>
        <div className="min-w-0">
          <fieldset className="grid gap-3 border border-rule p-4 sm:grid-cols-2">
            <legend className="px-1 text-sm font-semibold text-ink">{selected.name ?? selected.bucket}</legend>
            {fields.map(([key, label]) => (
              <label key={key} className="grid gap-1 text-sm font-medium text-ink">
                <span>
                  {label}
                  {requiredFields.has(key) && <><span aria-hidden="true" className="ml-1 text-warn">*</span><span className="sr-only"> (required)</span></>}
                </span>
                <input
                  required={requiredFields.has(key)}
                  aria-label={label}
                  value={String(editing.draft[key] ?? '')}
                  onChange={(event) => setEditing((current) => ({ ...current, draft: { ...current.draft, [key]: event.target.value } }))}
                  className={inputClass}
                />
              </label>
            ))}
            <p className="m-0 font-mono text-xs text-inkMute break-all sm:col-span-2">{selected.uuid}</p>
          </fieldset>
          <button
            type="button"
            disabled={!collectionHasChanges(editing.draft, selected.document)}
            onClick={() => void saveMetadata()}
            className="mt-3 border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Save collection
          </button>
          {(['species', 'locations'] as const).map((kind) => (
            <AssignmentChecklist
              key={kind}
              kind={kind}
              used={editing.used[kind]}
              shared={sharedFor(kind)}
              search={search[kind]}
              onSearch={(value) => setSearch((current) => ({ ...current, [kind]: value }))}
              onChange={(next) => setUsed(kind, next)}
              onUndo={() => undoUsed(kind)}
              canUndo={editing.undo[kind] !== null}
              onSave={() => void saveUsed(kind)}
              changed={JSON.stringify(editing.used[kind]) !== JSON.stringify(selected[`${kind}Assignment`].values)}
              outdated={outdated[kind]}
              onUpdateAll={() => updateAll(kind)}
              onUpdateOne={(index) => updateOne(kind, index)}
            />
          ))}
          {(message || retryApplied) && (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {message && <p role="status" className="m-0 text-sm text-inkSoft">{message}</p>}
              {retryApplied && <button
                type="button"
                onClick={() => void retryApplied()
                  .then(() => {
                    setRetryApplied(null)
                    setMessage('History entry saved.')
                    reload()
                  })
                  .catch((cause: Error) => setMessage(`The history entry still did not go through: ${cause.message}`))}
                className="border border-warn px-3 py-2 text-sm text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Retry history entry
              </button>}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
