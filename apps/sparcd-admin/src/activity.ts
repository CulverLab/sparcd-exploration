import type { AccessChangeDetail, ActivityEvent, ActivityKind } from './api'
import { EXACT_LOCATIONS, accessLabel } from './AccessChoices'

export type WhereName = (bucket?: string) => string

export const ACTIVITY_CHIPS: { id: string; label: string; kinds: ActivityKind[] }[] = [
  { id: 'downloads', label: 'Downloads', kinds: ['download'] },
  { id: 'uploads', label: 'Uploads', kinds: ['upload'] },
  { id: 'identifications', label: 'Identifications', kinds: ['identify'] },
  { id: 'access', label: 'Access changes', kinds: ['access-change'] },
  { id: 'lists', label: 'List changes', kinds: ['list-change', 'collection-change'] },
  { id: 'problems', label: 'Problems', kinds: ['denied', 'bad-signature'] },
]

export const fileName = (key?: string) => (key ? key.split('/').filter(Boolean).pop() ?? '' : '')

const listWord = (key?: string) => {
  if (key?.endsWith('species.json')) return 'species'
  if (key?.endsWith('locations.json')) return 'locations'
  return 'shared'
}

/**
 * Writes this app makes to do its own bookkeeping — the session marker and the
 * history entries beside every save. They are not a change anyone made to a
 * list, and one save emits several of them.
 */
export const isOwnBookkeeping = (event: ActivityEvent) =>
  event.kind === 'list-change' &&
  (event.key?.startsWith('Settings/admin-sessions/') === true ||
    event.key?.startsWith('Settings/audit/config/') === true)

const accessChangeSentence = (event: ActivityEvent, whereName: WhereName): { who: string; text: string } | null => {
  const detail = event.detail as AccessChangeDetail | undefined
  if (!detail?.change || !detail.target) return null
  const who = event.personName ?? 'Someone'
  const target = detail.target.personName
  const where = detail.collectionName ?? whereName(event.bucket)
  switch (detail.change) {
    case 'invited':
      return { who, text: `invited ${target}` }
    case 'joined':
      return { who: target, text: 'joined' }
    case 'paused':
      return { who, text: `paused ${target}'s access` }
    case 'resumed':
      return { who, text: `let ${target} sign in again` }
    case 'reset':
      return { who, text: `reset ${target}'s access` }
    case 'admin-granted':
      return { who, text: `made ${target} an administrator` }
    case 'admin-removed':
      return { who, text: `took ${target}'s administrator access away` }
    case 'added':
      return { who, text: `added ${target} to ${where} as ${accessLabel(detail.after!.access)}` }
    case 'removed':
      return { who, text: `removed ${target} from ${where}` }
    case 'changed': {
      const { before, after } = detail
      if (before && after && before.access !== after.access)
        return { who, text: `changed ${target} in ${where} from ${accessLabel(before.access)} to ${accessLabel(after.access)}` }
      if (before && after && before.exactLocations !== after.exactLocations)
        return { who, text: `turned ${after.exactLocations ? 'on' : 'off'} ${EXACT_LOCATIONS.label} for ${target} in ${where}` }
      return { who, text: `changed what ${target} can do in ${where}` }
    }
  }
}

/** The name in bold, and the rest of the sentence after it. */
export function activitySentence(event: ActivityEvent, whereName: WhereName): { who: string; text: string } {
  const who = event.personName ?? 'Someone'
  const where = whereName(event.bucket)
  const file = fileName(event.key)
  switch (event.kind) {
    case 'download':
      return { who, text: `downloaded ${file} from ${where}` }
    case 'upload':
      return { who, text: file ? `uploaded ${file} to ${where}` : `uploaded images to ${where}` }
    case 'identify':
      return { who, text: file ? `identified ${file} in ${where}` : `identified images in ${where}` }
    case 'list-change':
      return { who, text: `changed the ${listWord(event.key)} list` }
    case 'collection-change':
      return { who, text: `changed the details of ${where}` }
    case 'access-change':
      return accessChangeSentence(event, whereName)
        ?? { who, text: event.bucket ? `changed who can use ${where}` : 'changed what someone can do' }
    case 'denied':
      return { who, text: `tried to open something they don't have access to in ${where}` }
    case 'bad-signature':
      return { who, text: 'had a sign-in that did not work' }
    case 'sign-in':
      return { who, text: 'signed in' }
  }
}

export const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

const dayKey = (iso: string) => new Date(iso).toDateString()

export function dayHeading(iso: string, now = new Date()) {
  const long = new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(dayKey(iso)).getTime()) / 86400000)
  if (days === 0) return `Today · ${long}`
  if (days === 1) return `Yesterday · ${long}`
  return long
}

export function groupByDay(events: ActivityEvent[]) {
  const days: { key: string; events: ActivityEvent[] }[] = []
  for (const event of [...events].sort((a, b) => b.ts.localeCompare(a.ts))) {
    const key = dayKey(event.ts)
    const day = days.find((entry) => entry.key === key)
    if (day) day.events.push(event)
    else days.push({ key, events: [event] })
  }
  return days
}

export type TimelineRow = { event: ActivityEvent; who: string; text: string; count: number }

const RUN_MS = 60000

/**
 * A burst of the same thing reads as one line with a count. Each run is
 * measured from its own first event, so a long stream still breaks by minute.
 */
export function collapseRuns(events: ActivityEvent[], whereName: WhereName): TimelineRow[] {
  const rows: TimelineRow[] = []
  for (const event of events) {
    const { who, text } = activitySentence(event, whereName)
    const last = rows[rows.length - 1]
    const sameRun = last
      && last.event.kind === event.kind
      && last.event.personId === event.personId
      && last.event.bucket === event.bucket
      && last.text === text
      && Math.abs(Date.parse(event.ts) - Date.parse(last.event.ts)) <= RUN_MS
    if (sameRun) last.count += 1
    else rows.push({ event, who, text, count: 1 })
  }
  return rows
}

/** "IMG_0412.JPG from Research 1 was downloaded by Priya Nair on Sep 12, 14:03." */
export function downloadsSentence(file: string, where: string, events: ActivityEvent[]) {
  if (events.length === 0) return `Nobody has downloaded ${file} from ${where}.`
  const parts = events.map((event) => {
    const when = new Date(event.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `by ${event.personName ?? 'someone'} on ${when}, ${timeOf(event.ts)}`
  })
  const people = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${file} from ${where} was downloaded ${people}.`
}

/** Said on screen and again at the top of the spreadsheet, so a file that
 * leaves the app carries the reason it is short. */
export const TRUNCATION_NOTE = 'Showing the latest 200 events. Narrow the dates or filters to see the rest.'

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export function activityCsv(events: ActivityEvent[], whereName: WhereName, truncated = false) {
  const rows = truncated
    ? [[TRUNCATION_NOTE], ['When', 'Who', 'What', 'Collection', 'File']]
    : [['When', 'Who', 'What', 'Collection', 'File']]
  for (const event of events) {
    const { who, text } = activitySentence(event, whereName)
    rows.push([event.ts, who, text, event.bucket ? whereName(event.bucket) : '', fileName(event.key)])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export const sinceDays = (days: number, now = new Date()) =>
  new Date(now.getTime() - days * 86400000).toISOString()
