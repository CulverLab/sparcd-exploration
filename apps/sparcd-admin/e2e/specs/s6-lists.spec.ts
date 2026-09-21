// S6 — the two shared lists. A species rename has to reach storage and leave
// a history behind it, retiring is reversible, and a latitude that is not a
// plain decimal is refused where it was typed.

import { test, expect, type Page } from '@playwright/test'
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { openSection, s3, savedConnection, settled, signInAsAdmin, stack } from '../lib'

const NEW_NAME = 'Mountain Lion (puma)'

const species = (page: Page) => page.getByRole('region', { name: 'Species' })
const locations = (page: Page) => page.getByRole('region', { name: 'Locations' })

const text = async (client: ReturnType<typeof s3>, bucket: string, key: string) => {
  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return got.Body!.transformToString()
}

test('a species rename lands in storage with a history, and a bad latitude is refused', async ({ browser }) => {
  const { settingsBucket } = stack()
  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  const client = s3(await savedConnection(page))

  await openSection(page, 'Species')
  await species(page).getByRole('button', { name: /Mountain Lion/ }).click()
  await species(page).getByLabel('Common name').fill(NEW_NAME)
  await expect(species(page).getByText('1 species changed')).toBeVisible()
  await species(page).getByRole('button', { name: 'Save' }).click()
  await expect(species(page).getByRole('status')).toHaveText('Saved.')
  await settled(page)

  await expect.poll(async () => text(client, settingsBucket, 'Settings/species.json'))
    .toContain(NEW_NAME)

  const history = await client.send(new ListObjectsV2Command({
    Bucket: settingsBucket, Prefix: 'Settings/audit/config/',
  }))
  const keys = (history.Contents ?? []).map((entry) => entry.Key!)
  const prepared = keys.filter((key) => key.endsWith('.prepared.json'))
  const applied = keys.filter((key) => key.endsWith('.applied.json'))
  expect(prepared.length).toBeGreaterThan(0)
  expect(applied.length).toBeGreaterThan(0)
  const event = JSON.parse(await text(client, settingsBucket, prepared[0]))
  expect(event.action).toBe('species.updated')
  expect(event.actor).toBe('Jorge Delgado')
  expect(applied[0].replace('.applied.json', '')).toBe(prepared[0].replace('.prepared.json', ''))

  await openSection(page, 'Locations')
  const row = locations(page).getByRole('button', { name: /Bear Canyon Upper/ })
  const save = locations(page).getByRole('button', { name: 'Save', exact: true })

  await row.click()
  await locations(page).getByRole('button', { name: 'Retire', exact: true }).click()
  await save.click()
  await expect(locations(page).getByRole('status')).toHaveText('Saved.')
  await expect(row).toContainText('Retired')
  await settled(page)

  // The save leaves the same record open, so bringing it back is one click.
  await locations(page).getByRole('button', { name: 'Bring back', exact: true }).click()
  await save.click()
  await expect(locations(page).getByRole('status')).toHaveText('Saved.')
  await expect(row).toContainText('Active')
  await settled(page)

  // Number() would happily read 0x20 as 32 and write back a latitude nobody
  // typed, so the text is refused before it is ever converted.
  await locations(page).getByLabel('Latitude').fill('0x20')
  await expect(locations(page).getByRole('alert').first())
    .toHaveText('Latitude must be a number, like 32.158.')
  await locations(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(locations(page).getByRole('status'))
    .toHaveText('Location “Bear Canyon Upper”: Latitude must be a number, like 32.158.')
  expect(await text(client, settingsBucket, 'Settings/locations.json')).not.toContain('0x20')

  await context.close()
})
