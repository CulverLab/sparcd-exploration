import type { Access } from './api'

export const ACCESS_CHOICES: { value: Access; label: string }[] = [
  { value: 'look', label: 'Can look' },
  { value: 'identify', label: 'Can identify' },
  { value: 'upload', label: 'Can upload' },
  { value: 'run', label: 'Runs this collection' },
]

export const EXACT_LOCATIONS = {
  label: 'Sees exact camera locations',
}

export const WILL_BE_REMOVED = 'Will be removed'

const ORDER = ACCESS_CHOICES.map((choice) => choice.value)

// Before the service held sets, a membership was one level that included the
// ones below it. Activity written then still says so.
const LEGACY: Record<Access, Access[]> = {
  look: ['look'],
  identify: ['look', 'identify'],
  upload: ['look', 'identify', 'upload'],
  run: ['look', 'identify', 'upload', 'run'],
}

export const accessSet = (access: Access | Access[] | undefined): Access[] =>
  typeof access === 'string' ? LEGACY[access] ?? [] : ORDER.filter((value) => access?.includes(value))

/**
 * Identifying and running a collection both mean looking at it, so ticking
 * either ticks Can look, and unticking Can look unticks both. Uploading stands
 * alone: someone can send images in without browsing the collection.
 */
export function toggleAccess(access: Access[], value: Access, on: boolean): Access[] {
  const next = new Set(access)
  if (on) {
    next.add(value)
    if (value === 'identify' || value === 'run') next.add('look')
  } else {
    next.delete(value)
    if (value === 'look') {
      next.delete('identify')
      next.delete('run')
    }
  }
  return ORDER.filter((choice) => next.has(choice))
}

export type AccessRow = { access: Access[]; exactLocations: boolean }

/** The checkbox cells of one row: who or where is `label`, for the accessible names. */
export function AccessCells({ label, row, disabled, onChange }: {
  label: string
  row: AccessRow
  disabled?: boolean
  onChange: (next: AccessRow) => void
}) {
  return (
    <>
      {ACCESS_CHOICES.map((choice) => (
        <td key={choice.value} className="px-2 py-2 text-center">
          <input
            type="checkbox"
            disabled={disabled}
            aria-label={`${choice.label} for ${label}`}
            className="h-4 w-4 accent-accent"
            checked={row.access.includes(choice.value)}
            onChange={(event) => onChange({ ...row, access: toggleAccess(row.access, choice.value, event.target.checked) })}
          />
        </td>
      ))}
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          disabled={disabled}
          aria-label={`${EXACT_LOCATIONS.label} for ${label}`}
          className="h-4 w-4 accent-accent"
          checked={row.exactLocations}
          onChange={(event) => onChange({ ...row, exactLocations: event.target.checked })}
        />
      </td>
    </>
  )
}

export function AccessHeadings({ first }: { first: string }) {
  return (
    <tr className="text-left text-xs uppercase tracking-wider text-inkSoft">
      <th className="py-2 pr-3 font-semibold">{first}</th>
      {ACCESS_CHOICES.map((choice) => <th key={choice.value} className="px-2 py-2 font-semibold">{choice.label}</th>)}
      <th className="px-2 py-2 font-semibold">{EXACT_LOCATIONS.label}</th>
      <th className="py-2" />
    </tr>
  )
}
