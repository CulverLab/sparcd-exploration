// S6d — a collection's own details: finding it, changing it, the fields it
// cannot be saved without, and the change reaching its collection.json.

import { test, expect, type Page } from '@playwright/test'
import {
  collectionNamed, jsonOf, openSection, s3, savedConnection, settled, signInAsAdmin,
} from '../lib'

const CONTACT = 'field@skyislandalliance.example (summer crew)'
const DESCRIPTION = 'Camera traps across the Santa Catalina and Rincon sky islands, 2026 season.'

const collections = (page: Page) => page.getByRole('region', { name: 'Collections' })

test("a collection's details can be searched for, corrected and saved", async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  const client = s3(await savedConnection(page))

  await openSection(page, 'Collections')
  const search = collections(page).getByLabel('Search collections')
  const skyRow = collections(page).getByRole('button', { name: /Sky Islands 2026/ })

  await search.fill('Research')
  await expect(skyRow).toHaveCount(0)
  await expect(collections(page).getByRole('button', { name: /Research 1/ })).toBeVisible()
  await search.fill('zzz')
  await expect(collections(page).getByText('Nothing matches that search.').first()).toBeVisible()
  await search.fill('')

  await skyRow.first().click()
  await expect(collections(page).getByText(sky.uuid)).toBeVisible()

  const save = collections(page).getByRole('button', { name: /^Save collection/ })
  await expect(save).toBeDisabled()

  // A required field cleared is refused where it was cleared, and nothing is
  // written.
  await collections(page).getByLabel('Organization').fill('')
  await save.click()
  await expect(collections(page).getByText('Organization is required.')).toBeVisible()
  expect((await jsonOf<Record<string, string>>(client, sky.bucket, `Collections/${sky.uuid}/collection.json`))
    .organizationProperty).toBe('Sky Island Alliance')

  await collections(page).getByLabel('Organization').fill('Sky Island Alliance')
  await collections(page).getByLabel('Contact').fill(CONTACT)
  await collections(page).getByLabel('Description').fill(DESCRIPTION)
  await save.click()
  await expect(collections(page).getByText('Saved.', { exact: true })).toBeVisible()
  await settled(page)

  await expect.poll(async () =>
    await jsonOf<Record<string, string>>(client, sky.bucket, `Collections/${sky.uuid}/collection.json`))
    .toMatchObject({
      nameProperty: 'Sky Islands 2026',
      organizationProperty: 'Sky Island Alliance',
      contactInfoProperty: CONTACT,
      descriptionProperty: DESCRIPTION,
    })

  await expect(save).toBeDisabled()
  await context.close()
})
