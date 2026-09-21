import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../src/api'
import { activityCsv, activitySentence, dayHeading, downloadsSentence, groupByDay } from '../src/activity'

const where = (bucket?: string) => (bucket === 'sparcd-aaa' ? 'Research 1' : 'Sky Islands 2026')

const event = (kind: ActivityEvent['kind'], extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  ts: '2026-09-12T14:03:00.000Z',
  personName: 'Priya Nair',
  kind,
  bucket: 'sparcd-aaa',
  ...extra,
})

describe('the sentence for each kind', () => {
  it('names the file and the collection for a download', () => {
    expect(activitySentence(event('download', { key: 'Collections/aaa/Media/ab/IMG_0412.JPG' }), where)).toEqual({
      who: 'Priya Nair',
      text: 'downloaded IMG_0412.JPG from Research 1',
    })
  })

  it('covers uploads, with and without a file', () => {
    expect(activitySentence(event('upload', { key: 'Uploads/x/IMG_1.JPG' }), where).text).toBe('uploaded IMG_1.JPG to Research 1')
    expect(activitySentence(event('upload'), where).text).toBe('uploaded images to Research 1')
  })

  it('covers identifications', () => {
    expect(activitySentence(event('identify', { key: 'a/IMG_9.JPG' }), where).text).toBe('identified IMG_9.JPG in Research 1')
    expect(activitySentence(event('identify'), where).text).toBe('identified images in Research 1')
  })

  it('names which shared list changed', () => {
    expect(activitySentence(event('list-change', { key: 'Settings/species.json' }), where).text).toBe('changed the species list')
    expect(activitySentence(event('list-change', { key: 'Settings/locations.json' }), where).text).toBe('changed the locations list')
    expect(activitySentence(event('list-change', { key: 'Settings/other.json' }), where).text).toBe('changed the shared list')
  })

  it('covers collection details and access changes', () => {
    expect(activitySentence(event('collection-change'), where).text).toBe('changed the details of Research 1')
    expect(activitySentence(event('access-change'), where).text).toBe('changed who can use Research 1')
    expect(activitySentence(event('access-change', { bucket: undefined }), where).text).toBe('changed what someone can do')
  })

  it('covers problems and signing in', () => {
    expect(activitySentence(event('denied'), where).text).toBe("tried to open something they don't have access to in Research 1")
    expect(activitySentence(event('bad-signature'), where).text).toBe('had a sign-in that did not work')
    expect(activitySentence(event('sign-in'), where).text).toBe('signed in')
  })

  it('falls back to Someone when the service did not name anyone', () => {
    expect(activitySentence(event('sign-in', { personName: undefined }), where).who).toBe('Someone')
  })
})

describe('grouping and export', () => {
  it('groups by day, newest first', () => {
    const days = groupByDay([
      event('sign-in', { ts: '2026-09-10T08:00:00.000Z' }),
      event('sign-in', { ts: '2026-09-12T09:00:00.000Z' }),
      event('sign-in', { ts: '2026-09-12T18:00:00.000Z' }),
    ])
    expect(days).toHaveLength(2)
    expect(days[0].events).toHaveLength(2)
    expect(days[0].events[0].ts).toBe('2026-09-12T18:00:00.000Z')
  })

  it('heads today and yesterday by name', () => {
    const now = new Date('2026-09-12T20:00:00.000Z')
    expect(dayHeading('2026-09-12T09:00:00.000Z', now)).toMatch(/^Today · /)
    expect(dayHeading('2026-09-11T09:00:00.000Z', now)).toMatch(/^Yesterday · /)
    expect(dayHeading('2026-09-01T09:00:00.000Z', now)).not.toMatch(/^(Today|Yesterday)/)
  })

  it('answers who downloaded an image in one sentence', () => {
    const downloads = [
      event('download', { ts: '2026-09-12T14:03:00.000Z', personName: 'Priya Nair' }),
      event('download', { ts: '2026-09-09T09:41:00.000Z', personName: 'Todd Reyes' }),
    ]
    expect(downloadsSentence('IMG_0412.JPG', 'Research 1', downloads)).toMatch(
      /^IMG_0412\.JPG from Research 1 was downloaded by Priya Nair on Sep 12, \d\d:\d\d and by Todd Reyes on Sep 9, \d\d:\d\d\.$/,
    )
    expect(downloadsSentence('IMG_0412.JPG', 'Research 1', [])).toBe('Nobody has downloaded IMG_0412.JPG from Research 1.')
  })

  it('writes the shown events as a spreadsheet', () => {
    const csv = activityCsv([event('download', { key: 'a/IMG_0412.JPG' })], where)
    const [header, row] = csv.split('\n')
    expect(header).toBe('When,Who,What,Collection,File')
    expect(row).toBe('2026-09-12T14:03:00.000Z,Priya Nair,downloaded IMG_0412.JPG from Research 1,Research 1,IMG_0412.JPG')
  })
})
