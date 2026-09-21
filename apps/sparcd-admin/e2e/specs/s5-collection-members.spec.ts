// S5 — the members table on the Collections screen: who is in a collection,
// the rule that one of them has to run it, and a change that reaches storage.

import { test, expect, type Page } from '@playwright/test'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import {
  bytes, collectionNamed, openSection, recall, s3, signInAsAdmin, statusOf, type Connection,
} from '../lib'

const RUNNER_SENTENCE = 'A collection always needs at least one person running it.'

const collections = (page: Page) => page.getByRole('region', { name: 'Collections' })
const members = (page: Page) => page.getByRole('region', { name: 'People in this collection' })

test('the members table carries the rules and the change reaches storage', async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const luis = recall<Connection>('luis')

  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  await openSection(page, 'Collections')

  await collections(page).getByRole('button', { name: /Research 1/ }).first().click()
  await expect(members(page).getByRole('radio', { name: 'Can identify for Priya Nair' })).toBeChecked()

  await collections(page).getByRole('button', { name: /Sky Islands 2026/ }).first().click()
  await expect(members(page).getByRole('radio', { name: 'Can upload for Ana Morales' })).toBeChecked()
  await expect(members(page).getByRole('radio', { name: 'Can look for Luis Park' })).toBeChecked()
  await expect(members(page).getByText('Run by: nobody yet')).toBeVisible()

  await members(page).getByLabel('Add a person to this collection').fill('Priya')
  await members(page).getByRole('button', { name: 'Priya Nair' }).click()
  await expect(members(page).getByRole('row')).toHaveCount(4) // header plus three people

  await members(page).getByRole('radio', { name: 'Can identify for Luis Park' }).check()
  await members(page).getByRole('button', { name: 'Save people' }).click()
  await expect(members(page).getByRole('status')).toHaveText(RUNNER_SENTENCE)

  await members(page).getByRole('radio', { name: 'Runs this collection for Ana Morales' }).check()
  await members(page).getByRole('button', { name: 'Save people' }).click()
  await expect(members(page).getByRole('status')).toHaveText('Saved.')
  await expect(members(page).getByText('Run by: Ana Morales')).toBeVisible()

  const asLuis = s3(luis)
  const base = `Collections/${sky.uuid}/Uploads/${sky.stamp}`
  expect(await statusOf(asLuis.send(new PutObjectCommand({
    Bucket: sky.bucket, Key: `${base}/observations.csv`, Body: bytes('observationID,mediaID\n'), ContentType: 'text/csv',
  })))).toBe(200)
  expect(await statusOf(asLuis.send(new PutObjectCommand({
    Bucket: sky.bucket, Key: `${base}/LUIS_0002.JPG`, Body: bytes('luis'), ContentType: 'image/jpeg',
  })))).toBe(403)

  await context.close()
})
