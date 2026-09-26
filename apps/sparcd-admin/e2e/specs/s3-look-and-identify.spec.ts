// S3 — the two narrower choices. Luis can look at Sky Islands and nothing
// more; Priya can record identifications in Research 1 but cannot add photos
// to it. Neither of them can touch the shared species list.

import { test, expect } from '@playwright/test'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  bytes, collectionNamed, openInvite, openSection, remember, s3, savedConnection,
  signInAsAdmin, statusOf,
} from '../lib'

async function invite(page: import('@playwright/test').Page, person: {
  name: string
  email: string
  collection: string
  access: string
}) {
  await page.getByRole('button', { name: 'Add a person' }).click()
  const form = page.getByRole('region', { name: 'Add a person' })
  await form.getByLabel('Name').fill(person.name)
  await form.getByLabel('Email').fill(person.email)
  await form.getByLabel('Also add to a collection').selectOption({ label: person.collection })
  // The label carries the choice and its one-line explanation, so the
  // accessible name is both — match on the choice itself.
  await form.getByRole('radio', { name: person.access }).check()
  await form.getByRole('button', { name: 'Add person' }).click()
  const link = await form.getByLabel('Link to send').inputValue()
  await form.getByRole('button', { name: 'Done' }).click()
  return link
}

test('Luis can only look, and Priya can only identify', async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const research = collectionNamed('Research 1')

  const adminContext = await browser.newContext()
  const admin = await signInAsAdmin(adminContext)
  await openSection(admin, 'People')

  const luisLink = await invite(admin, {
    name: 'Luis Park', email: 'luis@example.org', collection: 'Sky Islands 2026', access: 'Can look',
  })
  const priyaLink = await invite(admin, {
    name: 'Priya Nair', email: 'priya@example.org', collection: 'Research 1', access: 'Can identify',
  })

  const luis = await openInvite(browser, luisLink)
  await expect(luis.page.getByRole('heading', { name: "Welcome, Luis Park. You're all set." })).toBeVisible()
  const luisConnection = await savedConnection(luis.page)
  remember('luis', luisConnection)

  const priya = await openInvite(browser, priyaLink)
  await expect(priya.page.getByRole('heading', { name: "Welcome, Priya Nair. You're all set." })).toBeVisible()
  const priyaConnection = await savedConnection(priya.page)
  remember('priya', priyaConnection)

  const asLuis = s3(luisConnection)
  const media = `Collections/${sky.uuid}/Uploads/${sky.stamp}/IMG_0413.JPG`
  expect(await statusOf(asLuis.send(new GetObjectCommand({ Bucket: sky.bucket, Key: media })))).toBe(200)
  const refused = `Collections/${sky.uuid}/Uploads/${sky.stamp}/LUIS_0001.JPG`
  expect(await statusOf(asLuis.send(new PutObjectCommand({
    Bucket: sky.bucket, Key: refused, Body: bytes('luis'), ContentType: 'image/jpeg',
  })))).toBe(403)

  const asPriya = s3(priyaConnection)
  const base = `Collections/${research.uuid}/Uploads/${research.stamp}`
  for (const key of [
    `${base}/observations.csv`,
    `${base}/media.csv`,
    `${base}/.sparcd-tagger-snapshots/priya%40example.org/2026.09.21.10.00.00/manifest.json`,
  ]) {
    expect(await statusOf(asPriya.send(new PutObjectCommand({
      Bucket: research.bucket, Key: key, Body: bytes('observationID,mediaID\n'), ContentType: 'text/csv',
    })))).toBe(200)
  }
  expect(await statusOf(asPriya.send(new PutObjectCommand({
    Bucket: research.bucket, Key: `${base}/PRIYA_0001.JPG`, Body: bytes('priya'), ContentType: 'image/jpeg',
  })))).toBe(403)

  const { settingsBucket } = await import('../lib').then((lib) => lib.stack())
  for (const [who, client] of [['Luis', asLuis], ['Priya', asPriya]] as const) {
    const status = await statusOf(client.send(new PutObjectCommand({
      Bucket: settingsBucket, Key: 'Settings/species.json', Body: bytes('[]'), ContentType: 'application/json',
    })))
    expect(status, `${who} must not be able to rewrite the shared species list`).toBe(403)
  }

  await luis.context.close()
  await priya.context.close()
  await adminContext.close()
})
