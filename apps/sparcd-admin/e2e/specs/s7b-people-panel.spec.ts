// S7b — the People panel one person at a time: finding them, putting them in a
// collection, changing what they can do there, taking it away again, the two
// confirmations that can be backed out of, and the email an administrator
// actually sends.

import { test, expect, type Page } from '@playwright/test'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  bytes, collectionNamed, openSection, recall, s3, signInAsAdmin, statusOf, type Connection,
} from '../lib'

const people = (page: Page) => page.getByRole('region', { name: 'People' })
// The person list names a person's collections too, so an access row is picked
// out by the two buttons only it carries.
const accessRow = (page: Page, where: string) =>
  people(page).getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: 'Remove' }) })
    .filter({ hasText: where })
    .first()

/** The proxy that made the change applies it at once; this outlasts a hiccup. */
async function statusWithin(request: () => Promise<unknown>, want: number) {
  const deadline = Date.now() + 6000
  for (;;) {
    const got = await statusOf(request())
    if (got === want || Date.now() > deadline) return got
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

test('one person moved into a collection, changed, and taken back out', async ({ browser }) => {
  const research = collectionNamed('Research 1')
  const luis = recall<Connection>('luis')
  const asLuis = s3(luis)
  const media = `Collections/${research.uuid}/Uploads/${research.stamp}/IMG_1190.JPG`
  const notes = `Collections/${research.uuid}/Uploads/${research.stamp}/observations.csv`
  const read = () => asLuis.send(new GetObjectCommand({ Bucket: research.bucket, Key: media }))
  const write = () => asLuis.send(new PutObjectCommand({
    Bucket: research.bucket, Key: notes, Body: bytes('observationID,mediaID\n'), ContentType: 'text/csv',
  }))

  expect(await statusOf(read())).toBe(403)

  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  await openSection(page, 'People')

  const search = people(page).getByLabel('Search people')
  await search.fill('Priya')
  await expect(people(page).getByRole('listitem')).toHaveCount(1)
  await search.fill('zzz')
  await expect(people(page).getByText('Nobody matches that search.')).toBeVisible()
  await search.fill('')

  await people(page).getByRole('button', { name: /Luis Park/ }).first().click()
  await expect(people(page).getByText('Sky Islands 2026 · Can identify')).toBeVisible()

  // Into a second collection, at the narrowest level.
  await page.getByRole('button', { name: 'Add to a collection' }).click()
  await people(page).getByLabel('Collection', { exact: true }).selectOption({ label: 'Research 1' })
  await people(page).getByRole('radio', { name: 'Can look' }).check()
  await page.getByRole('button', { name: 'Add to collection' }).click()
  await expect(people(page).getByText('Research 1 · Can look')).toBeVisible()
  expect(await statusWithin(read, 200)).toBe(200)
  expect(await statusOf(write())).toBe(403)

  // Widened, and the extra choice beside the level comes with it.
  await accessRow(page, 'Research 1').getByRole('button', { name: 'Change' }).click()
  await people(page).getByRole('radio', { name: 'Can identify' }).check()
  await people(page).getByRole('checkbox', { name: 'Sees exact camera locations' }).check()
  await page.getByRole('button', { name: 'Save access' }).click()
  await expect(people(page).getByText('Research 1 · Can identify · sees exact locations')).toBeVisible()
  expect(await statusWithin(write, 200)).toBe(200)

  // And taken away again.
  await accessRow(page, 'Research 1').getByRole('button', { name: 'Remove' }).click()
  await expect(people(page).getByText('Research 1 · Can identify · sees exact locations')).toHaveCount(0)
  await expect(people(page).getByText('Sky Islands 2026 · Can identify')).toBeVisible()
  expect(await statusWithin(read, 403)).toBe(403)

  // Both dangerous buttons ask first, and backing out changes nothing.
  await page.getByRole('button', { name: 'Reset access' }).click()
  await expect(page.getByText("Reset Luis Park's access? Their current sign-in stops working straight away.")).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Reset access' })).toBeVisible()

  await page.getByRole('button', { name: 'Pause access' }).click()
  await expect(page.getByText("Pause Luis Park's access? They keep their collections but can't sign in until you resume.")).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Pause access' })).toBeVisible()
  const sky = collectionNamed('Sky Islands 2026')
  expect(await statusOf(asLuis.send(new GetObjectCommand({
    Bucket: sky.bucket, Key: `Collections/${sky.uuid}/Uploads/${sky.stamp}/IMG_0413.JPG`,
  })))).toBe(200)

  // The invite an administrator actually sends: the link, and the mail behind
  // "Email it instead".
  await page.getByRole('button', { name: 'Add a person' }).click()
  const form = page.getByRole('region', { name: 'Add a person' })
  await form.getByLabel('Name').fill('Ivy Chen')
  await form.getByLabel('Email').fill('ivy@example.org')
  await form.getByRole('button', { name: 'Add person' }).click()

  const link = await form.getByLabel('Link to send').inputValue()
  const href = await form.getByRole('link', { name: 'Email it instead' }).getAttribute('href')
  const mail = new URL(href!)
  expect(decodeURIComponent(mail.pathname)).toBe('ivy@example.org')
  expect(mail.searchParams.get('subject')).toBe("Your SPARC'd link")
  const body = mail.searchParams.get('body')!
  expect(body).toContain('Hi Ivy,')
  expect(body).toContain("Here's your link to SPARC'd. It opens once and expires in 7 days.")
  expect(body).toContain(link)
  expect(body.trimEnd().endsWith('Jorge Delgado')).toBe(true)

  await form.getByRole('button', { name: 'Copy' }).click()
  await expect(form.getByRole('button', { name: 'Copied' })).toBeVisible()

  await form.getByRole('button', { name: 'Add another person' }).click()
  await expect(form.getByLabel('Name')).toHaveValue('')
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('region', { name: 'Add a person' })).toHaveCount(0)

  await context.close()
})
