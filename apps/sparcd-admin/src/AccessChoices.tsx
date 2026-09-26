import type { Access, Membership } from './api'

export const ACCESS_CHOICES: { value: Access; label: string; help: string }[] = [
  { value: 'look', label: 'Can look', help: 'View images and identifications' },
  { value: 'identify', label: 'Can identify', help: 'Look plus tag species' },
  { value: 'upload', label: 'Can upload', help: 'Identify plus add new images' },
  { value: 'run', label: 'Runs this collection', help: 'Upload plus manage people and fix uploads' },
]

export const EXACT_LOCATIONS = {
  label: 'Sees exact camera locations',
  help: 'Off by default. Turn on only for people who need coordinates for protected locations.',
}

export const accessLabel = (access: Access) =>
  ACCESS_CHOICES.find((choice) => choice.value === access)?.label ?? 'Can look'

/** "Sky Islands 2026 · Can upload · sees exact locations" */
export function membershipSentence(membership: Membership, name?: string | null) {
  const where = name ?? membership.name ?? membership.bucket
  const parts = [where, accessLabel(membership.access)]
  if (membership.exactLocations) parts.push('sees exact locations')
  return parts.join(' · ')
}

export function AccessChoices({ name, value, onChange, exactLocations, onExactLocations }: {
  name: string
  value: Access
  onChange: (next: Access) => void
  exactLocations: boolean
  onExactLocations: (next: boolean) => void
}) {
  return (
    <fieldset className="grid gap-2 border border-ruleSoft p-3">
      <legend className="sr-only">What this person can do</legend>
      {ACCESS_CHOICES.map((choice) => (
        <label key={choice.value} className="flex items-start gap-2 text-sm text-ink">
          <input
            type="radio"
            name={name}
            className="mt-1 h-4 w-4 accent-accent"
            checked={value === choice.value}
            onChange={() => onChange(choice.value)}
          />
          <span>
            <span className="block">{choice.label}</span>
            <span className="block text-xs text-inkSoft">{choice.help}</span>
          </span>
        </label>
      ))}
      <label className="mt-1 flex items-start gap-2 border-t border-ruleSoft pt-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-accent"
          checked={exactLocations}
          onChange={(event) => onExactLocations(event.target.checked)}
        />
        <span>
          <span className="block">{EXACT_LOCATIONS.label}</span>
          <span className="block text-xs text-inkSoft">{EXACT_LOCATIONS.help}</span>
        </span>
      </label>
    </fieldset>
  )
}
