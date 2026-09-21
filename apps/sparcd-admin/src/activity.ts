import type { ActivityEvent, ActivityKind } from './api'

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
      return { who, text: event.bucket ? `changed who can use ${where}` : 'changed what someone can do' }
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

/** "IMG_0412.JPG from Research 1 was downloaded by Priya Nair on Sep 12, 14:03." */
export function downloadsSentence(file: string, where: string, events: ActivityEvent[]) {
  if (events.length === 0) return `Nobody has downloaded ${file} from ${where}.`
  const parts = events.map((event) => {
    const when = new Date(event.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${event.personName ?? 'Someone'} on ${when}, ${timeOf(event.ts)}`
  })
  const people = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${file} from ${where} was downloaded by ${people}.`
}

const csvCell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)

export function activityCsv(events: ActivityEvent[], whereName: WhereName) {
  const rows = [['When', 'Who', 'What', 'Collection', 'File']]
  for (const event of events) {
    const { who, text } = activitySentence(event, whereName)
    rows.push([event.ts, who, text, event.bucket ? whereName(event.bucket) : '', fileName(event.key)])
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\n')
}

export const sinceDays = (days: number, now = new Date()) =>
  new Date(now.getTime() - days * 86400000).toISOString()
