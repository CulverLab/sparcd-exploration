// Sa — the other two apps, built and served the way a deploy ships them, signed
// in to with logins this suite's administrator handed out, talking to the same
// access proxy.
//
// Nadia can upload, so she completes a real upload of real JPEGs and the
// objects are there afterwards. Omar can only look, so the same attempt is
// refused and he is told so in a sentence. Rae can identify, so she opens
// Nadia's upload in the Tagger, tags an image, saves, and the observations file
// changes — and she still cannot add a photo.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Browser, type Page } from '@playwright/test'
import { ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3'
import { jpegWithExifDate } from '../../../sparcd-uploader/features/steps/fixtures-data'
import {
  TAGGER, UPLOADER, collectionNamed, keysUnder, openInvite, openSection, recall, remember,
  s3, savedConnection, signInAsAdmin, signInHere, statusOf, textOf, type Connection,
} from '../lib'

test.describe.configure({ timeout: 240_000 })

const WHO = 'Nadia Rossi'
const LOCATION = 'Bear Canyon Upper'
const SPECIES = 'Puma concolor'
// The common name, not the renamed-in-S6 full string: the tile truncates.
const SPECIES_NAME = 'Mountain Lion'

const PHOTOS = ['NAD_0001.JPG', 'NAD_0002.JPG', 'NAD_0003.JPG']

/**
 * Three small but genuine JPEGs, each with its own capture time and hash, in a
 * folder on disk: the Uploader takes a card, not a handful of files, so its
 * file input is a directory picker.
 */
function card() {
  const root = mkdtempSync(join(tmpdir(), 'sparcd-admin-e2e-'))
  const folder = join(root, 'SDCARD')
  mkdirSync(folder)
  PHOTOS.forEach((name, index) =>
    writeFileSync(join(folder, name), jpegWithExifDate(`2026:07:0${index + 1} 0${index + 1}:15:00`, `nadia-${index}`)))
  return { root, folder }
}

/** The Uploader probes 8443–8462 only on a bare https endpoint. Ours is not. */
const SHARD_PORTS = /:(84(4[3-9]|5\d|6[0-2]))(\/|$)/

/** The known-harmless refusal every app earns on sign-in. See the note below. */
const SETTINGS_PROBE = /sparcd-settings-[^/]*\/Collections\/settings-[^/]*\/collection\.json/

/** The Tagger asks every visible bucket for the species list. Only one has it. */
const SPECIES_PROBE = /^404 HEAD .*\/Settings\/species\.json$/

async function invite(page: Page, person: { name: string; email: string; access: string }) {
  await page.getByRole('button', { name: 'Add a person' }).click()
  const form = page.getByRole('region', { name: 'Add a person' })
  await form.getByLabel('Name').fill(person.name)
  await form.getByLabel('Email').fill(person.email)
  await form.getByLabel('Also add to a collection').selectOption({ label: 'Sky Islands 2026' })
  await form.getByRole('radio', { name: person.access }).check()
  await form.getByRole('button', { name: 'Add person' }).click()
  const link = await form.getByLabel('Link to send').inputValue()
  await form.getByRole('button', { name: 'Done' }).click()
  return link
}

async function joinAs(browser: Browser, link: string) {
  const joined = await openInvite(browser, link)
  await expect(joined.page.getByRole('heading', { name: /You're all set\./ })).toBeVisible()
  const connection = await savedConnection(joined.page)
  await joined.context.close()
  return connection
}

/** Sign in to one of the sibling apps and wait until it is past the gate. */
async function openApp(browser: Browser, url: string, who: Connection) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const seen: string[] = []
  // Every refusal the proxy hands one of these apps is a finding, so they are
  // collected rather than left in the browser's console.
  const trouble: string[] = []
  page.on('request', (request) => seen.push(request.url()))
  page.on('pageerror', (error) => trouble.push(`pageerror: ${error.message}\n${error.stack}`))
  page.on('console', (message) => {
    // The bare "Failed to load resource" is the same refusal the response
    // handler already has, spelt less usefully.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      trouble.push(`console: ${message.text()}`)
    }
  })
  page.on('requestfailed', (request) =>
    trouble.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`))
  page.on('response', (response) => {
    if (response.status() >= 400) trouble.push(`${response.status()} ${response.request().method()} ${response.url()}`)
  })
  await page.goto(url)
  await signInHere(page, who)
  return { context, page, seen, trouble }
}

const listbox = (page: Page, at: number) => page.locator('button[aria-haspopup="listbox"]').nth(at)

/** Feed the Uploader its files and walk it as far as the Upload step. */
async function driveUploader(page: Page) {
  const { root, folder } = card()
  try {
    await page.locator('input[type="file"]').first().setInputFiles(folder)
  } finally {
    setTimeout(() => rmSync(root, { recursive: true, force: true }), 30_000).unref()
  }
  await expect(page.locator('[aria-label^="Scanned files"]')).toBeVisible({ timeout: 60_000 })
  await expect(async () => {
    const shown = await page.locator('body').innerText()
    expect(/\bprocessing\b|Processing…|Queued/i.test(shown)).toBe(false)
  }).toPass({ timeout: 60_000 })

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Target collection' })).toBeVisible()

  // Only the collection this person was put in is ever on offer: the proxy
  // never named the other one to them.
  await listbox(page, 0).click()
  const choices = page.locator('ul[role="listbox"] li[role="option"]')
  await expect(choices).toHaveCount(1)
  await expect(choices.first()).toContainText('Sky Islands 2026')
  await expect(choices.first()).not.toContainText('Research 1')
  await choices.first().click()
  await expect(choices).toHaveCount(0)

  await listbox(page, 1).click()
  await page.locator('ul[role="listbox"] li[role="option"]').filter({ hasText: LOCATION }).first().click()
  await page.getByPlaceholder('e.g. John Doe').first().fill(WHO)

  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Upload', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^Start (dry run|upload)$/ }).click()
  return page.locator('section span.font-mono.uppercase').first()
}

test('the administrator invites three people onto one collection', async ({ browser }) => {
  const context = await browser.newContext()
  const admin = await signInAsAdmin(context)
  await openSection(admin, 'People')

  remember('nadia', await joinAs(browser, await invite(admin, {
    name: WHO, email: 'nadia@example.org', access: 'Can upload',
  })))
  remember('omar', await joinAs(browser, await invite(admin, {
    name: 'Omar Haddad', email: 'omar@example.org', access: 'Can look',
  })))
  remember('rae', await joinAs(browser, await invite(admin, {
    name: 'Rae Lindqvist', email: 'rae@example.org', access: 'Can identify',
  })))

  await context.close()
})

test('a person who can upload completes a real one in the Uploader', async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const context = await browser.newContext()
  const admin = await signInAsAdmin(context)
  const asAdmin = s3(await savedConnection(admin))

  const uploader = await openApp(browser, UPLOADER, recall<Connection>('nadia'))
  await expect(uploader.page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 30_000 })

  const before = new Set(await uploadPrefixes(asAdmin, sky))
  const phase = await driveUploader(uploader.page)
  await expect(phase).toHaveText('done', { timeout: 120_000 })
  const complete = uploader.page.getByRole('dialog', { name: 'Upload complete' })
  if (await complete.isVisible().catch(() => false)) await complete.getByRole('button', { name: 'OK' }).click()

  // The shard probe walks 8443-8462 on a bare https endpoint. This one carries
  // a port, so it must not have dialled anything.
  expect(uploader.seen.filter((url) => SHARD_PORTS.test(url)), 'the shard probe must stay quiet here').toEqual([])

  const added = (await uploadPrefixes(asAdmin, sky)).filter((prefix) => !before.has(prefix))
  expect(added, 'exactly one new upload').toHaveLength(1)
  remember('nadiaUpload', added[0])

  // Nothing she is entitled to was refused. The one exception is a request the
  // app should not be making: `listCollections` treats every `sparcd-*` bucket
  // as a collection, so it asks the settings bucket for a collection.json that
  // cannot exist and the proxy — rightly — says no.
  // packages/s3-safe/src/index.ts:579
  // Refusals only. A write the browser aborted and the Uploader made good on
  // — which is what happens to a lane or two against slow storage — is its own
  // business, and the objects checked below are the proof it recovered.
  expect(uploader.trouble.filter((line) => /^\d{3} /.test(line) && !SETTINGS_PROBE.test(line)),
    'nothing she may do was refused').toEqual([])
  expect(uploader.trouble.filter((line) => line.startsWith('pageerror')), 'the Uploader never fell over').toEqual([])
  const uploaded = await keysUnder(asAdmin, sky.bucket, added[0])
  for (const leaf of [...PHOTOS, 'media.csv', 'observations.csv', 'deployments.csv', 'UploadMeta.json', 'UploadComplete.json']) {
    expect(uploaded.some((key) => key.endsWith(`/${leaf}`)), `${leaf} is in storage`).toBe(true)
  }
  await uploader.context.close()

  // The administrator's Activity screen has it.
  await openSection(admin, 'Activity')
  const activity = admin.getByRole('region', { name: 'Activity' })
  await activity.getByRole('button', { name: 'Uploads' }).click()
  await expect(activity.getByRole('listitem').filter({ hasText: `${WHO} uploaded` }).first())
    .toBeVisible({ timeout: 20_000 })

  await context.close()
})

test('a person who can only look is refused, and told so in a sentence', async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const context = await browser.newContext()
  const admin = await signInAsAdmin(context)
  const asAdmin = s3(await savedConnection(admin))
  const uploads = (await uploadPrefixes(asAdmin, sky)).length

  const looker = await openApp(browser, UPLOADER, recall<Connection>('omar'))
  await expect(looker.page.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 30_000 })
  const phase = await driveUploader(looker.page)
  await expect(phase).toHaveText(/error|partial/, { timeout: 120_000 })

  const shown = await looker.page.locator('body').innerText()
  expect(looker.trouble.some((line) => line.startsWith('403')), 'the proxy refused him').toBe(true)
  expect(shown, 'the refusal is a sentence, not a stack trace').not.toContain('AccessDenied')
  expect(shown).not.toContain('<Error>')
  expect(shown).not.toContain('SignatureDoesNotMatch')
  expect((await uploadPrefixes(asAdmin, sky)).length, 'nothing of his was published').toBe(uploads)

  await looker.context.close()
  await context.close()
})

test('a person who can identify tags an image in the Tagger, and still cannot upload', async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const rae = recall<Connection>('rae')
  const prefix = recall<string>('nadiaUpload')
  const context = await browser.newContext()
  const admin = await signInAsAdmin(context)
  const asAdmin = s3(await savedConnection(admin))

  const tagger = await openApp(browser, TAGGER, rae)
  const page = tagger.page
  const sections = page.locator('nav[aria-label="Sections"]:visible')
  await expect(sections.getByRole('button', { name: 'Browse' })).toBeVisible({ timeout: 30_000 })

  // Nothing is written without a name on it.
  await sections.getByRole('button', { name: 'Settings' }).click()
  await page.locator('#user').fill('Rae Lindqvist')
  await sections.getByRole('button', { name: 'Browse' }).click()

  await page.locator('aside').getByRole('button').filter({ hasText: 'Sky Islands 2026' }).first().click()
  await expect(page.getByRole('heading', { name: /Uploads in Sky Islands 2026/ })).toBeVisible({ timeout: 30_000 })

  const row = page.locator('button').filter({ hasText: 'Open' }).filter({ hasText: 'nadia-rossi' }).first()
  await expect(row, 'the upload is listed').toBeVisible({ timeout: 60_000 })
  await row.click()
  await expect(page.getByRole('button', { name: 'Sync\u2026' })).toBeVisible({ timeout: 30_000 })

  const tile = page.locator(`button[title="${PHOTOS[0]}"]`)
  await tile.click()
  await expect(tile).toHaveAttribute('aria-current', 'true')
  await page.locator('div.group').filter({ hasText: SPECIES }).first()
    .locator('button[title^="Apply"], button[title$="already applied"]').first().click()
  await expect(tile).toContainText(SPECIES_NAME)

  await page.getByRole('button', { name: 'Sync\u2026' }).click()
  await expect(page.getByRole('heading', { name: 'Sync to S3' })).toBeVisible()
  await expect(page.getByText('Checking the canonical base\u2026')).toBeHidden({ timeout: 60_000 })
  await page.getByRole('button', { name: 'Sync now' }).click()
  await expect(page.getByText('Synced \u2014 canonical files replaced.')).toBeVisible({ timeout: 60_000 })

  await expect.poll(() => textOf(asAdmin, sky.bucket, `${prefix}observations.csv`)).toContain(SPECIES)

  expect(tagger.trouble.filter((line) => line.startsWith('pageerror')), 'the Tagger never fell over').toEqual([])
  expect(tagger.trouble.filter((line) => /^40\d/.test(line) && !SETTINGS_PROBE.test(line) && !SPECIES_PROBE.test(line)),
    'nothing she may do was refused').toEqual([])
  await tagger.context.close()

  // Identifying is not uploading.
  expect(await statusOf(s3(rae).send(new PutObjectCommand({
    Bucket: sky.bucket, Key: `${prefix}RAE_0001.JPG`, Body: Buffer.from('rae'), ContentType: 'image/jpeg',
  })))).toBe(403)

  await context.close()
})

/** The `Collections/<uuid>/Uploads/<stamp>/` prefixes that exist right now. */
async function uploadPrefixes(client: ReturnType<typeof s3>, sky: { bucket: string; uuid: string }) {
  const listed = await client.send(new ListObjectsV2Command({
    Bucket: sky.bucket, Prefix: `Collections/${sky.uuid}/Uploads/`, Delimiter: '/',
  }))
  return (listed.CommonPrefixes ?? []).map((entry) => entry.Prefix!)
}
