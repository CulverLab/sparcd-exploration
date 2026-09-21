import { useEffect, useState } from 'react'
import type { AccessApi, ActivityEvent, Person } from './api'
import {
  ACTIVITY_CHIPS,
  activityCsv,
  collapseRuns,
  dayHeading,
  downloadsSentence,
  fileName,
  groupByDay,
  isOwnBookkeeping,
  sinceDays,
  timeOf,
} from './activity'

const kindWord: Record<string, string> = {
  download: 'download', upload: 'upload', identify: 'identify', 'list-change': 'list change',
  'collection-change': 'collection', 'access-change': 'access', denied: 'problem', 'bad-signature': 'problem',
  'sign-in': 'sign-in',
}

export function ActivityScreen({ api, collections, people }: {
  api: AccessApi
  collections: { bucket: string; name: string }[]
  people: Person[]
}) {
  const [chips, setChips] = useState<string[]>([])
  const [person, setPerson] = useState('')
  const [bucket, setBucket] = useState('')
  const [days, setDays] = useState(7)
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [problem, setProblem] = useState('')
  const [lookupBucket, setLookupBucket] = useState('')
  const [lookupName, setLookupName] = useState('')
  const [answer, setAnswer] = useState('')

  const whereName = (target?: string) =>
    collections.find((entry) => entry.bucket === target)?.name ?? target ?? 'this collection'

  useEffect(() => {
    let dropped = false
    const kinds = ACTIVITY_CHIPS.filter((chip) => chips.includes(chip.id)).flatMap((chip) => chip.kinds)
    api.activity({ from: sinceDays(days), person: person || undefined, bucket: bucket || undefined, kind: kinds.length ? kinds : undefined })
      .then((result) => { if (!dropped) { setEvents(result.events); setProblem('') } })
      .catch((cause: Error) => { if (!dropped) setProblem(cause.message) })
    return () => { dropped = true }
  }, [chips, person, bucket, days])

  const lookUp = async () => {
    const target = lookupBucket || collections[0]?.bucket
    if (!target || !lookupName.trim()) return
    try {
      const found = await api.downloadsOf(target, lookupName.trim())
      setAnswer(downloadsSentence(fileName(lookupName.trim()) || lookupName.trim(), whereName(target), found))
    } catch (cause) {
      setAnswer((cause as Error).message)
    }
  }

  const shown = events.filter((event) => !isOwnBookkeeping(event))

  const download = () => {
    const blob = new Blob([activityCsv(shown, whereName)], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'activity.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const inputClass = 'min-h-10 border border-rule bg-paper px-2 text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

  return (
    <section className="border border-rule bg-panel" aria-labelledby="activity-heading">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 id="activity-heading" className="m-0 text-lg font-semibold text-ink">Activity</h1>
          <p className="mb-0 mt-1 text-sm text-inkSoft">Everything people did, in plain sentences.</p>
        </div>
        <button type="button" onClick={download} className="border border-rule px-3 py-2 text-sm text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
          Download as spreadsheet
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-3">
        <label className="sr-only" htmlFor="activity-person">Person</label>
        <select id="activity-person" className={inputClass} value={person} onChange={(event) => setPerson(event.target.value)}>
          <option value="">Everyone</option>
          {people.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="activity-collection">Collection</label>
        <select id="activity-collection" className={inputClass} value={bucket} onChange={(event) => setBucket(event.target.value)}>
          <option value="">All collections</option>
          {collections.map((entry) => <option key={entry.bucket} value={entry.bucket}>{entry.name}</option>)}
        </select>
        {ACTIVITY_CHIPS.map((chip) => {
          const on = chips.includes(chip.id)
          return (
            <button
              key={chip.id}
              type="button"
              aria-pressed={on}
              onClick={() => setChips(on ? chips.filter((id) => id !== chip.id) : [...chips, chip.id])}
              className={`border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                on ? 'border-ink bg-accentSoft text-ink' : 'border-rule text-inkSoft hover:text-ink'
              }`}
            >
              {chip.label}
            </button>
          )
        })}
        <label className="sr-only" htmlFor="activity-range">Time range</label>
        <select id="activity-range" className={`${inputClass} ml-auto`} value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>

      <div className="border-b border-rule px-4 py-3">
        <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-inkSoft">Who downloaded this image?</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="lookup-collection">Collection</label>
          <select id="lookup-collection" className={inputClass} value={lookupBucket} onChange={(event) => setLookupBucket(event.target.value)}>
            {collections.map((entry) => <option key={entry.bucket} value={entry.bucket}>{entry.name}</option>)}
          </select>
          <label className="sr-only" htmlFor="lookup-name">Image name</label>
          <input id="lookup-name" className={`${inputClass} min-w-0 flex-1`} placeholder="IMG_0412.JPG" value={lookupName} onChange={(event) => setLookupName(event.target.value)} />
          <button type="button" onClick={() => void lookUp()} className="border border-rule px-3 py-2 text-sm text-ink hover:bg-paperHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Look it up</button>
        </div>
        {answer && <p className="mb-0 mt-2 text-sm text-ink">{answer}</p>}
      </div>

      <div className="p-4">
        {problem && <p role="alert" className="text-sm text-warn">{problem}</p>}
        {!problem && shown.length === 0 && <p className="m-0 text-sm text-inkSoft">Nothing happened in this stretch.</p>}
        {groupByDay(shown).map((day) => (
          <div key={day.key} className="mb-4 border border-ruleSoft">
            <h2 className="m-0 border-b border-ruleSoft px-3 py-2 text-xs font-semibold uppercase tracking-wider text-inkSoft">{dayHeading(day.events[0].ts)}</h2>
            <ul className="m-0 list-none p-0">
              {collapseRuns(day.events, whereName).map((row, index) => (
                <li key={`${row.event.ts}-${index}`} className="flex items-center gap-3 border-b border-ruleSoft px-3 py-2 text-sm last:border-b-0">
                  <span className="min-w-0 flex-1 text-ink">
                    <b>{row.who}</b> {row.text}
                    {row.count > 1 && <span className="text-inkSoft"> · {row.count} times</span>}
                  </span>
                  <span className="shrink-0 border border-ruleSoft px-1.5 py-0.5 font-mono text-xs text-inkSoft">{kindWord[row.event.kind]}</span>
                  <span className="w-12 shrink-0 text-right font-mono text-xs text-inkSoft">{timeOf(row.event.ts)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
