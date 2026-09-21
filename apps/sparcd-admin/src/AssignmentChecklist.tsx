export type Kind = 'species' | 'locations'
export type Entry = Record<string, unknown>

export const idOf = (kind: Kind, entry: Entry) =>
  String(entry[kind === 'species' ? 'scientificName' : 'idProperty'] ?? '').trim().toLocaleLowerCase()
export const nameOf = (kind: Kind, entry: Entry) =>
  String(entry[kind === 'species' ? 'name' : 'nameProperty'] ?? '').trim().toLocaleLowerCase()

/**
 * Legacy data repeats location IDs, so an ID on its own can point at two
 * different sites. Narrow by name when it does, and give up rather than
 * guess — a wrong guess silently rewrites one site's record with another's.
 */
export function matchShared(kind: Kind, entry: Entry, shared: Entry[]): Entry | null {
  const byId = shared.filter((candidate) => idOf(kind, candidate) === idOf(kind, entry))
  if (byId.length === 1) return byId[0]
  const byName = byId.filter((candidate) => nameOf(kind, candidate) === nameOf(kind, entry))
  return byName.length === 1 ? byName[0] : null
}

export const sharedHasId = (kind: Kind, entry: Entry, shared: Entry[]) =>
  shared.some((candidate) => idOf(kind, candidate) === idOf(kind, entry))

export type ChecklistRow = {
  label: string
  detail: string
  status: 'active' | 'retired' | 'unlisted'
  usedIndex: number
  /** What gets stored when the row is ticked. */
  entry: Entry
}

const rowLabel = (kind: Kind, entry: Entry) =>
  String(entry[kind === 'species' ? 'name' : 'nameProperty'] ?? '').trim() ||
  String(entry[kind === 'species' ? 'scientificName' : 'idProperty'] ?? '').trim() ||
  'Unnamed'

const rowDetail = (kind: Kind, entry: Entry) =>
  String(entry[kind === 'species' ? 'scientificName' : 'idProperty'] ?? '').trim()

/**
 * One row per active shared entry, plus a row for anything this collection
 * still uses that the shared list has retired, dropped, or holds twice.
 */
export function checklistRows(kind: Kind, used: unknown[], shared: unknown[]): ChecklistRow[] {
  const usedEntries = used as Entry[]
  const sharedEntries = shared as Entry[]
  const claimed = new Set<number>()
  const rows: ChecklistRow[] = []

  for (const entry of sharedEntries) {
    const usedIndex = usedEntries.findIndex(
      (candidate, index) => !claimed.has(index) && matchShared(kind, candidate, sharedEntries) === entry,
    )
    if (usedIndex >= 0) claimed.add(usedIndex)
    if (entry.retired === true && usedIndex < 0) continue
    rows.push({
      label: rowLabel(kind, entry),
      detail: rowDetail(kind, entry),
      status: entry.retired === true ? 'retired' : 'active',
      usedIndex,
      entry,
    })
  }

  usedEntries.forEach((entry, index) => {
    if (claimed.has(index)) return
    rows.push({
      label: rowLabel(kind, entry),
      detail: rowDetail(kind, entry),
      status: sharedHasId(kind, entry, sharedEntries) ? 'active' : 'unlisted',
      usedIndex: index,
      entry,
    })
  })

  return rows.sort((a, b) => a.label.localeCompare(b.label) || a.detail.localeCompare(b.detail))
}

export function activeCount(shared: unknown[]) {
  return (shared as Entry[]).filter((entry) => entry.retired !== true).length
}

const statusWord = { active: '', retired: 'Retired', unlisted: 'Not in the shared list' } as const

export function AssignmentChecklist({
  kind,
  used,
  shared,
  search,
  onSearch,
  onChange,
  onUndo,
  canUndo,
  onSave,
  changed,
  outdated,
  onUpdateAll,
  onUpdateOne,
}: {
  kind: Kind
  used: unknown[]
  shared: unknown[]
  search: string
  onSearch: (value: string) => void
  onChange: (next: unknown[]) => void
  onUndo: () => void
  canUndo: boolean
  onSave: () => void
  changed: boolean
  outdated: { index: number; current: Entry; truth: Entry }[]
  onUpdateAll: () => void
  onUpdateOne: (index: number) => void
}) {
  const plural = kind === 'species' ? 'species' : 'locations'
  const one = kind === 'species' ? 'species' : 'location'
  const rows = checklistRows(kind, used, shared)
  const needle = search.trim().toLocaleLowerCase()
  const visible = needle
    ? rows.filter((row) => `${row.label} ${row.detail}`.toLocaleLowerCase().includes(needle))
    : rows

  const toggle = (row: ChecklistRow) =>
    onChange(row.usedIndex >= 0 ? used.filter((_, index) => index !== row.usedIndex) : [...used, row.entry])

  return (
    <details className="mt-4 border border-rule">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
        {kind === 'species' ? 'Species' : 'Locations'} used in this collection
      </summary>
      <div className="p-4">
        <p className="mb-3 mt-0 text-sm text-inkSoft">{used.length} of {activeCount(shared)} {plural} used here.</p>
        {outdated.length > 0 && (
          <div className="mb-3 border border-warn p-3">
            <div className="flex flex-wrap items-center gap-3">
              <p className="m-0 text-sm text-ink">
                {outdated.length === 1 ? '1 entry is' : `${outdated.length} entries are`} out of date with the shared list.
              </p>
              <button
                type="button"
                onClick={onUpdateAll}
                className="border border-rule px-3 py-1.5 text-sm text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              >
                Update them
              </button>
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-inkSoft">Review one by one</summary>
              <ul className="mt-2 list-none p-0">
                {outdated.map((entry) => (
                  <li key={entry.index} className="flex items-center gap-3 py-1 text-sm text-ink">
                    <span className="min-w-0 flex-1 truncate">{rowLabel(kind, entry.current)} → {rowLabel(kind, entry.truth)}</span>
                    <button type="button" className="underline" onClick={() => onUpdateOne(entry.index)}>Update</button>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        )}
        <label className="block text-sm font-medium text-ink" htmlFor={`${kind}-search`}>Search {plural}</label>
        <input
          id={`${kind}-search`}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder={`Search ${plural}`}
          className="mt-1 min-h-10 w-full max-w-lg border border-rule bg-paper px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
        <ul className="mt-2 max-h-72 list-none overflow-y-auto border border-ruleSoft p-0">
          {visible.map((row) => (
            <li key={`${row.status}-${row.detail}-${row.label}-${row.usedIndex}`} className="border-b border-ruleSoft last:border-b-0">
              <label className={`flex items-center gap-2 px-3 py-2 text-sm text-ink ${row.status === 'active' ? '' : 'opacity-70'}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={row.usedIndex >= 0}
                  onChange={() => toggle(row)}
                />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <span className="shrink-0 text-xs text-inkSoft">{row.detail}</span>
                {row.status !== 'active' && <span className="shrink-0 text-xs text-inkMute">{statusWord[row.status]}</span>}
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="px-3 py-2 text-sm text-inkSoft">Nothing matches that search.</li>}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          {canUndo && (
            <button
              type="button"
              onClick={onUndo}
              className="border border-rule px-3 py-2 text-sm text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Undo
            </button>
          )}
          <button
            type="button"
            disabled={!used.length || !changed}
            onClick={onSave}
            className="border border-ink bg-ink px-3 py-2 text-sm font-semibold text-paper disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
          >
            Save {plural}
          </button>
        </div>
        {!used.length && <p role="alert" className="mb-0 mt-2 text-sm text-warn">Keep at least one {one} in this collection.</p>}
      </div>
    </details>
  )
}
