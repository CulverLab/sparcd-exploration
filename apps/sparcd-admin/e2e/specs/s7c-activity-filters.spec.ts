// S7c — the Activity screen's filters, the way a burst reads as one line, and
// what comes out of the spreadsheet button.

import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  bytes, collectionNamed, openSection, recall, s3, signInAsAdmin, statusOf, type Connection,
} from '../lib'

const BURST = 'BURST_0001.JPG'

// The chip, and the words the timeline is allowed to show while it is on.
const CHIPS: [string, string[]][] = [
  ['Downloads', ['download']],
  ['Uploads', ['upload']],
  ['Identifications', ['identify']],
  ['Access changes', ['access']],
  ['List changes', ['list change', 'collection']],
  ['Problems', ['problem']],
]

const activity = (page: Page) => page.getByRole('region', { name: 'Activity' })
const rows = (page: Page) => activity(page).getByRole('listitem')

/** The kind pill on every row currently shown — the only bordered span in one. */
const kinds = (page: Page) => activity(page).locator('li span.border').allTextContents()

test('the activity filters, a burst as one line, and the spreadsheet', async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const ana = recall<Connection>('ana')
  const asAna = s3(ana)
  const key = `Collections/${sky.uuid}/Uploads/${sky.stamp}/${BURST}`

  expect(await statusOf(asAna.send(new PutObjectCommand({
    Bucket: sky.bucket, Key: key, Body: bytes('burst'), ContentType: 'image/jpeg',
  })))).toBe(200)
  for (let n = 0; n < 3; n += 1) {
    expect(await statusOf(asAna.send(new GetObjectCommand({ Bucket: sky.bucket, Key: key })))).toBe(200)
  }

  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  await openSection(page, 'Activity')

  // Three reads of one file inside a minute are one line with a count on it.
  const burst = rows(page).filter({ hasText: `downloaded ${BURST} from Sky Islands 2026` })
  await expect(async () => {
    await expect(burst).toHaveCount(1, { timeout: 1000 })
    await expect(burst).toContainText('3 times', { timeout: 1000 })
  }).toPass({ timeout: 20000 })

  // Every chip, one at a time: it has something to show, and it shows nothing
  // else.
  for (const [label, words] of CHIPS) {
    await activity(page).getByRole('button', { name: label }).click()
    await expect(async () => {
      const shown = await kinds(page)
      expect(shown.length, `${label} has nothing to show`).toBeGreaterThan(0)
      expect(shown.filter((word) => !words.includes(word)), `${label} showed something else`).toEqual([])
    }).toPass({ timeout: 15000 })
    await activity(page).getByRole('button', { name: label }).click()
  }

  // One person's downloads and nobody else's.
  await activity(page).getByLabel('Person').selectOption({ label: 'Ana Morales' })
  await activity(page).getByRole('button', { name: 'Downloads' }).click()
  await expect(async () => {
    const texts = await rows(page).allTextContents()
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.every((line) => line.includes('Ana Morales') && line.includes('downloaded'))).toBe(true)
  }).toPass({ timeout: 15000 })
  await activity(page).getByRole('button', { name: 'Downloads' }).click()
  await activity(page).getByLabel('Person').selectOption({ label: 'Everyone' })

  // One collection and nothing from the other.
  await activity(page).getByLabel('Collection', { exact: true }).first().selectOption({ label: 'Research 1' })
  await expect(async () => {
    const texts = await rows(page).allTextContents()
    expect(texts.length).toBeGreaterThan(0)
    expect(texts.some((line) => line.includes('Sky Islands 2026'))).toBe(false)
  }).toPass({ timeout: 15000 })
  await activity(page).getByLabel('Collection', { exact: true }).first().selectOption({ label: 'All collections' })

  // A wider stretch can only hold more.
  const week = await rows(page).count()
  await activity(page).getByLabel('Time range').selectOption({ label: 'Last 30 days' })
  await expect.poll(() => rows(page).count()).toBeGreaterThanOrEqual(week)
  await activity(page).getByLabel('Time range').selectOption({ label: 'Last 7 days' })

  // The spreadsheet is the same sentences, one row each. It is whatever the
  // screen is holding at the moment of the click, so it is taken again until
  // the screen has caught up rather than once and hopefully.
  await expect(async () => {
    const saving = page.waitForEvent('download')
    await activity(page).getByRole('button', { name: 'Download as spreadsheet' }).click()
    const file = await saving
    expect(file.suggestedFilename()).toBe('activity.csv')
    const csv = readFileSync(await file.path(), 'utf8').split('\n')
    expect(csv[0]).toBe('When,Who,What,Collection,File')
    expect(csv.length).toBeGreaterThan(1)
    // Every download, not the one line the timeline collapses them to.
    expect(csv.filter((line) =>
      line.includes(`downloaded ${BURST} from Sky Islands 2026`) && line.endsWith(BURST))).toHaveLength(3)
    expect(csv.some((line) => line.includes('Settings/access'))).toBe(false)
  }).toPass({ timeout: 20000 })

  await context.close()
})
