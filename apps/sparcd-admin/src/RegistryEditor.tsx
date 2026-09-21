import { useEffect, useId, useRef, useState } from 'react'
import { ConditionalReplaceConflictError, type SafeS3Client } from '@sparcd/s3-safe'
import type { SharedList } from './load'
import {
  changedRecordsValidationError,
  normalizeNumbers,
  numberFieldError,
  NUMERIC_LOCATION_FIELDS,
  type Entry,
  type ListKind,
} from './validation'

export type Registry = SharedList

const json = (value: unknown) => JSON.stringify(value, null, 2)
const id = () => crypto.randomUUID()

const fields = {
  Species: ['name', 'scientificName', 'genus', 'species', 'keyBinding'],
  Locations: ['nameProperty', 'idProperty', 'latProperty', 'lngProperty', 'elevationProperty'],
} as const
const labels: Record<string, string> = {
  name: 'Common name', scientificName: 'Scientific name', genus: 'Genus', species: 'Species', keyBinding: 'Shortcut key',
  nameProperty: 'Name', idProperty: 'Location ID', latProperty: 'Latitude', lngProperty: 'Longitude', elevationProperty: 'Elevation',
}
const requiredFields: Record<ListKind, readonly string[]> = {
  Species: ['name', 'scientificName'],
  Locations: ['nameProperty', 'idProperty', 'latProperty', 'lngProperty', 'elevationProperty'],
}

export function updateItem(items: Entry[], at: number, next: Entry) {
  return items.map((value, index) => (index === at ? next : value))
}

/** Retiring is reversible: the same row carries the record back into use. */
export function setRetired(items: Entry[], at: number, retired: boolean) {
  return updateItem(items, at, { ...items[at], retired })
}

export function hasRecordData(record: Entry) {
  return Object.values(record).some((value) => value !== '' && value !== undefined && value !== null)
}

export function discardBlankDraft(items: Entry[], draftIndex: number | null) {
  return draftIndex !== null && !hasRecordData(items[draftIndex])
    ? items.filter((_, index) => index !== draftIndex)
    : items
}

export function changedRecordCount(items: Entry[], initial: unknown[]) {
  const count = Math.max(items.length, initial.length)
  return Array.from({ length: count }, (_, index) =>
    JSON.stringify(items[index]) !== JSON.stringify(initial[index]),
  ).filter(Boolean).length
}

const rowLabel = (kind: ListKind, record: Entry) =>
  String((kind === 'Species' ? record.name : record.nameProperty) ?? '').trim() || 'Unnamed'
const rowDetail = (kind: ListKind, record: Entry) =>
  String((kind === 'Species' ? record.scientificName : record.idProperty) ?? '').trim()

/** What a record is still known by after a save, so a reload can re-find it. */
const identityOf = (kind: ListKind, record: Entry) =>
  JSON.stringify(kind === 'Species'
    ? [record.name, record.scientificName]
    : [record.idProperty, record.nameProperty])

function StatusPill({ retired }: { retired: boolean }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-xs ${retired ? 'border-ruleSoft text-inkMute' : 'border-ok text-ok'}`}>
      <span aria-hidden className="text-[7px] leading-none">●</span>
      {retired ? 'Retired' : 'Active'}
    </span>
  )
}

function Shield() {
  return (
    <>
      <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 shrink-0 text-inkSoft" fill="none" stroke="currentColor" strokeWidth="1.4">
        <path d="M8 1.6 13.4 3.4v4.1c0 3.1-2.2 5.4-5.4 6.9-3.2-1.5-5.4-3.8-5.4-6.9V3.4Z" />
      </svg>
      <span className="sr-only">Protected</span>
    </>
  )
}

export function RegistryEditor({ title, registry, client, reload, actor }: {
  title: ListKind
  registry: Registry
  client: SafeS3Client
  reload: () => void | Promise<void>
  actor: string
}) {
  const [items, setItems] = useState(registry.value as Entry[])
  const [selected, setSelected] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [retryApplied, setRetryApplied] = useState<(() => Promise<void>) | null>(null)
  const [draftIndex, setDraftIndex] = useState<number | null>(null)
  const [etag, setEtag] = useState(registry.etag)
  // What the draft is measured against. It only moves when the draft is taken
  // over by fresh data, so a reload elsewhere cannot silently rebase an edit.
  const [baseline, setBaseline] = useState(registry.value)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = useRef(false)
  const searchId = useId()
  // The record a save left open, so the reload it triggers can re-select it
  // rather than dropping the person back to an empty pane.
  const keep = useRef<string | null>(null)

  const adopt = (next: Registry) => {
    const list = next.value as Entry[]
    const at = keep.current === null ? -1 : list.findIndex((record) => identityOf(title, record) === keep.current)
    keep.current = null
    setItems(list)
    setBaseline(next.value)
    setEtag(next.etag)
    setSelected(at === -1 ? null : at)
    setDraftIndex(null)
    setShowErrors(false)
    setStale(false)
    setSaving(false)
  }

  useEffect(() => {
    if (registry.value === baseline) return
    if (!dirty.current) { adopt(registry); return }
    // Someone is mid-edit. Take the new version tag when the data behind the
    // draft is unchanged; otherwise keep the draft and say what happened.
    if (JSON.stringify(registry.value) === JSON.stringify(baseline)) setEtag(registry.etag)
    else setStale(true)
  }, [registry])

  const noun = title === 'Species' ? 'species' : 'location'
  const plural = title === 'Species' ? 'species' : 'locations'
  const item = selected === null ? null : items[selected] ?? null

  const change = (key: string, value: string | boolean) => {
    setItems(updateItem(items, selected!, { ...item, [key]: value }))
    if (draftIndex === selected) setDraftIndex(null)
  }

  // A new record is always appended, so dropping an untouched one never moves
  // the index of anything else in the list.
  const select = (next: number | null) => {
    setItems(discardBlankDraft(items, draftIndex))
    setDraftIndex(null)
    setShowErrors(false)
    setSelected(next)
  }

  const addRecord = () => {
    if (draftIndex !== null) { setSelected(draftIndex); return }
    setItems([...items, {}])
    setSelected(items.length)
    setDraftIndex(items.length)
    setShowErrors(false)
  }

  const staged = normalizeNumbers(title, discardBlankDraft(items, draftIndex))
  const modifiedCount = changedRecordCount(staged, baseline)
  dirty.current = modifiedCount > 0
  const visible = items
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => {
      const needle = search.trim().toLocaleLowerCase()
      if (!needle) return true
      return `${rowLabel(title, record)} ${rowDetail(title, record)}`.toLocaleLowerCase().includes(needle)
    })

  const save = async () => {
    const invalid = changedRecordsValidationError(title, staged, baseline)
    if (invalid) {
      setShowErrors(true)
      setMessage(invalid)
      return
    }
    keep.current = selected !== null && staged[selected] ? identityOf(title, staged[selected]) : null
    setSaving(true)
    try {
      const occurredAt = new Date().toISOString()
      const eventId = id()
      const base = `Settings/audit/config/${occurredAt.slice(0, 10)}/${eventId}`
      const event = {
        schemaVersion: 1,
        eventId,
        occurredAt,
        actor,
        action: `${title.toLowerCase()}.updated`,
        target: { registryKey: registry.key },
        before: baseline,
        after: staged,
      }
      await client.writeImmutable(registry.bucket, `${base}.prepared.json`, json(event), { contentType: 'application/json' })
      const write = await client.replaceIfUnchanged(registry.bucket, registry.key, json(staged), {
        etag,
        contentType: 'application/json',
      })
      // The list is saved from here on, whatever the history entry does: hold
      // its new version tag and take the saved list as the new baseline.
      if (write.etag) setEtag(write.etag)
      setItems(staged)
      setBaseline(staged)
      const applied = () => client.writeImmutable(registry.bucket, `${base}.applied.json`, json({
        ...event,
        appliedAt: new Date().toISOString(),
        afterETag: write.etag,
      }), { contentType: 'application/json' })
      try {
        await applied()
        setRetryApplied(null)
        setMessage('Saved.')
        await reload()
        setSaving(false)
      } catch {
        setRetryApplied(() => applied)
        setMessage('Saved. Its history entry did not go through.')
        setSaving(false)
      }
    } catch (error) {
      setMessage(error instanceof ConditionalReplaceConflictError
        ? `Someone else changed this list while you were editing. Reload before saving again.`
        : (error as Error).message)
      setSaving(false)
    }
  }

  const inputClass = 'min-h-10 border border-rule bg-paper px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

  return (
    <section className="border border-rule bg-panel" aria-labelledby={`${title}-heading`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-rule px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 id={`${title}-heading`} className="m-0 text-lg font-semibold text-ink">{title}</h1>
          <p className="mb-0 mt-1 text-sm text-inkSoft">
            {title === 'Species'
              ? 'The species everyone picks from when they identify photos.'
              : 'The places everyone picks from when they upload. Changing a location ID only affects new uploads; IDs already recorded stay as they are.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {modifiedCount > 0 && <p className="m-0 text-sm text-inkSoft">{modifiedCount} {modifiedCount === 1 ? noun : plural} changed</p>}
          <button
            type="button"
            disabled={saving || modifiedCount === 0 || retryApplied !== null}
            className="border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {stale && (
        <div className="flex flex-wrap items-center gap-3 border-b border-warn px-4 py-3">
          <p className="m-0 text-sm text-warn">Someone else changed this list. Reload to see their changes.</p>
          <button
            type="button"
            onClick={() => adopt(registry)}
            className="border border-warn px-3 py-1.5 text-sm text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Reload
          </button>
        </div>
      )}
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <div className="min-w-0">
          <div className="flex gap-2">
            <label className="sr-only" htmlFor={searchId}>Search {plural}</label>
            <input
              id={searchId}
              disabled={saving}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Search ${plural}`}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button
              type="button"
              disabled={saving}
              onClick={addRecord}
              className="shrink-0 border border-rule px-3 py-2 text-sm text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              {title === 'Species' ? 'Add species' : 'Add location'}
            </button>
          </div>
          <p className="mb-0 mt-2 text-sm text-inkSoft">{items.length} {items.length === 1 ? noun : plural} in the list</p>
          <ul className="mt-2 max-h-[32rem] list-none overflow-y-auto border border-ruleSoft p-0">
            {visible.map(({ record, index }) => (
              <li key={index} className="border-b border-ruleSoft last:border-b-0">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => select(index)}
                  aria-current={selected === index ? 'true' : undefined}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm focus-visible:outline focus-visible:outline-2 -outline-offset-2 focus-visible:outline-accent ${
                    selected === index ? 'bg-accentSoft' : 'hover:bg-paperHover'
                  } ${record.retired === true ? 'opacity-60' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{rowLabel(title, record)}</span>
                    <span className="block truncate text-xs text-inkSoft">{rowDetail(title, record)}</span>
                  </span>
                  {title === 'Locations' && record.sensitive === true && <Shield />}
                  <StatusPill retired={record.retired === true} />
                </button>
              </li>
            ))}
            {visible.length === 0 && <li className="px-3 py-2 text-sm text-inkSoft">Nothing matches that search.</li>}
          </ul>
        </div>
        <div className="min-w-0">
          {item === null
            ? <p className="m-0 border border-ruleSoft bg-paper p-3 text-sm text-inkSoft">Pick a {noun} from the list to change it, or add a new one.</p>
            : (
              <>
                <fieldset disabled={saving} className="grid gap-3 border border-rule p-4 sm:grid-cols-2">
                  <legend className="px-1 text-sm font-semibold text-ink">{rowLabel(title, item)}</legend>
                  {fields[title].map((key) => {
                    const numeric = (NUMERIC_LOCATION_FIELDS as readonly string[]).includes(key)
                    const raw = String(item[key] ?? '')
                    const error = numeric ? numberFieldError(key, raw) : null
                    const shown = error && (showErrors || raw.trim() !== '')
                    return (
                      <label key={key} className="grid gap-1 text-sm font-medium text-ink">
                        <span>
                          {labels[key]}
                          {requiredFields[title].includes(key) && <><span aria-hidden="true" className="ml-1 text-warn">*</span><span className="sr-only"> (required)</span></>}
                        </span>
                        <input
                          aria-label={labels[key]}
                          required={requiredFields[title].includes(key)}
                          className={inputClass}
                          value={raw}
                          onChange={(event) => change(key, event.target.value)}
                        />
                        {shown && <span role="alert" className="text-xs font-normal text-warn">{error}</span>}
                      </label>
                    )
                  })}
                  {title === 'Locations' && (
                    <label className="grid gap-1 text-sm font-medium text-ink sm:col-span-2">
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-accent"
                          checked={item.sensitive === true}
                          onChange={(event) => change('sensitive', event.target.checked)}
                        />
                        Protected location
                      </span>
                      <span className="font-normal text-inkSoft">Hides exact coordinates from people without access. Use for endangered species sites.</span>
                    </label>
                  )}
                </fieldset>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    className="border border-rule px-3 py-2 text-sm text-ink hover:bg-paperHover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => setItems(setRetired(items, selected!, item.retired !== true))}
                  >
                    {item.retired === true ? 'Bring back' : 'Retire'}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    className="border border-rule px-3 py-2 text-sm text-inkSoft hover:bg-paperHover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                    onClick={() => select(null)}
                  >
                    Close
                  </button>
                </div>
              </>
            )}
        </div>
      </div>
      {(message || retryApplied) && (
        <div className="flex flex-wrap items-center gap-3 border-t border-rule px-4 py-3">
          {message && <p role="status" className="m-0 text-sm text-inkSoft">{message}</p>}
          {retryApplied && <button
            type="button"
            className="border border-warn px-3 py-2 text-sm text-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => void retryApplied()
              .then(() => {
                setRetryApplied(null)
                setMessage('History entry saved.')
                reload()
              })
              .catch((error: Error) => setMessage(`The history entry still did not go through: ${error.message}`))}
          >
            Retry history entry
          </button>}
        </div>
      )}
    </section>
  )
}
