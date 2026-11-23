// S4 — the three things an administrator reaches for when something is wrong:
// pause, resume, and hand out a fresh sign-in.

import { test, expect, type Page } from '@playwright/test'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import {
  collectionNamed, openInvite, openSection, recall, remember, s3, savedConnection,
  signInAsAdmin, statusOf, type Connection,
} from '../lib'

const USED = 'This link has already been used or has expired. Ask your administrator for a new one.'

/** The contract gives another proxy 5 s to notice; this one is the one that
 *  made the change, so 6 s is generous and still catches a change that never
 *  propagates at all. */
async function statusWithin(connection: Connection, request: () => Promise<unknown>, want: number) {
  const deadline = Date.now() + 6000
  let last = 0
  for (;;) {
    last = await statusOf(request())
    if (last === want) return last
    if (Date.now() > deadline) return last
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const openAna = async (page: Page) => {
  await openSection(page, 'People')
  await page.getByRole('button', { name: /Ana Morales/ }).first().click()
}

test('pausing, resuming and resetting Ana all take effect', async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const before = recall<Connection>('ana')
  const media = `Collections/${sky.uuid}/Uploads/${sky.stamp}/IMG_0414.JPG`
  const get = (connection: Connection) => () =>
    s3(connection).send(new GetObjectCommand({ Bucket: sky.bucket, Key: media }))

  expect(await statusOf(get(before)())).toBe(200)

  const adminContext = await browser.newContext()
  const admin = await signInAsAdmin(adminContext)
  await openAna(admin)

  await admin.getByRole('button', { name: 'Pause access' }).click()
  await admin.getByRole('button', { name: 'Yes, pause access' }).click()
  await expect(admin.getByRole('button', { name: 'Resume access' })).toBeVisible()
  expect(await statusWithin(before, get(before), 403)).toBe(403)

  await admin.getByRole('button', { name: 'Resume access' }).click()
  await admin.getByRole('button', { name: 'Yes, resume access' }).click()
  await expect(admin.getByRole('button', { name: 'Pause access' })).toBeVisible()
  expect(await statusWithin(before, get(before), 200)).toBe(200)

  await admin.getByRole('button', { name: 'Reset access' }).click()
  await admin.getByRole('button', { name: 'Yes, reset access' }).click()
  const link = admin.getByLabel('Link to send')
  await expect(link).toBeVisible()
  const inviteUrl = await link.inputValue()

  expect(await statusWithin(before, get(before), 403)).toBe(403)

  const ana = await openInvite(browser, inviteUrl)
  await expect(ana.page.getByRole('heading', { name: "Welcome, Ana Morales. You're all set." })).toBeVisible()
  const after = await savedConnection(ana.page)
  expect(after.accessKey).not.toBe(before.accessKey)
  remember('ana', after)
  expect(await statusOf(get(after)())).toBe(200)

  const again = await openInvite(browser, inviteUrl)
  await expect(again.page.getByRole('alert')).toHaveText(USED)

  await again.context.close()
  await ana.context.close()
  await adminContext.close()
})
