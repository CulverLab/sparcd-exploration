// S6b — the rest of the two shared lists: searching them, adding to them,
// the Protected flag on a location, and the one rule that has to hold on a
// list legacy data already contradicts — a location ID may move to a free
// value, may not land on a taken one, and the two rows that have shared an ID
// since before anyone was watching stay editable.

import { test, expect, type Page } from '@playwright/test'
import {
  jsonOf, openSection, s3, savedConnection, settled, signInAsAdmin, stack,
} from '../lib'

type Location = Record<string, unknown>
type Species = Record<string, unknown>

const species = (page: Page) => page.getByRole('region', { name: 'Species' })
const locations = (page: Page) => page.getByRole('region', { name: 'Locations' })

/** The count of changed records only clears once this save's write landed. */
const pendingIn = (region: ReturnType<typeof species>, word: string) =>
  region.getByText(new RegExp(`\\d+ ${word} changed`))

test('the lists can be searched and added to, and a location ID may only move somewhere free', async ({ browser }) => {
  const { settingsBucket } = stack()
  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  const client = s3(await savedConnection(page))

  await openSection(page, 'Species')

  // Searching narrows the list and says so when it narrows to nothing.
  await species(page).getByLabel('Search species').fill('Bobcat')
  await expect(species(page).getByRole('listitem')).toHaveCount(1)
  await species(page).getByLabel('Search species').fill('zzz')
  await expect(species(page).getByText('Nothing matches that search.')).toBeVisible()
  await species(page).getByLabel('Search species').fill('')
  await expect(species(page).getByText('8 species in the list')).toBeVisible()

  // A new species, typed in and saved.
  const speciesPending = pendingIn(species(page), 'species')
  const speciesSave = species(page).getByRole('button', { name: 'Save', exact: true })
  await species(page).getByRole('button', { name: 'Add species' }).click()
  await species(page).getByLabel('Common name').fill('Ringtail')
  await species(page).getByLabel('Scientific name').fill('Bassariscus astutus')
  await expect(species(page).getByText('9 species in the list')).toBeVisible()
  await speciesSave.click()
  await expect(speciesPending).toHaveCount(0)
  await expect(species(page).getByRole('status')).toHaveText('Saved.')
  await settled(page)

  await expect.poll(async () =>
    (await jsonOf<Species[]>(client, settingsBucket, 'Settings/species.json'))
      .some((entry) => entry.scientificName === 'Bassariscus astutus')).toBe(true)

  // Retired here so the collection checklist in S6e has a retired entry that a
  // collection is still using.
  await species(page).getByRole('button', { name: /Javelina/ }).click()
  await species(page).getByRole('button', { name: 'Retire', exact: true }).click()
  await expect(speciesPending).toBeVisible()
  await speciesSave.click()
  await expect(speciesPending).toHaveCount(0)
  await expect(species(page).getByRole('button', { name: /Javelina/ })).toContainText('Retired')
  await settled(page)

  await openSection(page, 'Locations')
  const pending = pendingIn(locations(page), 'locations?')
  const save = locations(page).getByRole('button', { name: 'Save', exact: true })

  await locations(page).getByLabel('Search locations').fill('Rincon')
  await expect(locations(page).getByRole('listitem')).toHaveCount(2)
  await locations(page).getByLabel('Search locations').fill('')

  // A new location, protected, and the shield that says so on its row.
  await locations(page).getByRole('button', { name: 'Add location' }).click()
  await locations(page).getByLabel('Name', { exact: true }).fill('Madera Overlook')
  await locations(page).getByLabel('Location ID').fill('MAD-15')
  await locations(page).getByLabel('Latitude').fill('31.7261')
  await locations(page).getByLabel('Longitude').fill('-110.8804')
  await locations(page).getByLabel('Elevation').fill('1710')
  await locations(page).getByLabel('Protected location').check()
  await save.click()
  await expect(pending).toHaveCount(0)
  await expect(locations(page).getByRole('status')).toHaveText('Saved.')
  await settled(page)

  const madera = locations(page).getByRole('button', { name: /Madera Overlook/ })
  await expect(madera).toContainText('Protected')
  await expect.poll(async () =>
    (await jsonOf<Location[]>(client, settingsBucket, 'Settings/locations.json'))
      .find((entry) => entry.idProperty === 'MAD-15')?.sensitive).toBe(true)

  // A location ID may move to a value nothing else is using.
  await locations(page).getByRole('button', { name: /Bear Canyon Lower/ }).click()
  await locations(page).getByLabel('Location ID').fill('BCL-22')
  await save.click()
  await expect(pending).toHaveCount(0)
  await expect(locations(page).getByRole('status')).toHaveText('Saved.')
  await settled(page)
  await expect.poll(async () =>
    (await jsonOf<Location[]>(client, settingsBucket, 'Settings/locations.json'))
      .some((entry) => entry.idProperty === 'BCL-22')).toBe(true)

  // It may not land on one another active location already holds.
  await locations(page).getByRole('button', { name: /Bear Canyon Lower/ }).click()
  await locations(page).getByLabel('Location ID').fill('BCU-01')
  await save.click()
  await expect(locations(page).getByRole('status'))
    .toHaveText('Location “Bear Canyon Lower”: Location ID is already used by another location.')
  expect(await jsonOf<Location[]>(client, settingsBucket, 'Settings/locations.json'))
    .toEqual(expect.arrayContaining([expect.objectContaining({ idProperty: 'BCL-22' })]))

  // Putting it back leaves nothing changed, so there is nothing left to save.
  await locations(page).getByLabel('Location ID').fill('BCL-22')
  await expect(pending).toHaveCount(0)
  await expect(save).toBeDisabled()

  // The two sites legacy data gave one ID stay editable: the rule only speaks
  // up about a record that is new or whose own ID just changed.
  await locations(page).getByRole('button', { name: /Chiricahua Spring/ }).click()
  await expect(locations(page).getByLabel('Location ID')).toHaveValue('CHI-07')
  await locations(page).getByLabel('Elevation').fill('2050')
  await save.click()
  await expect(pending).toHaveCount(0)
  await expect(locations(page).getByRole('status')).toHaveText('Saved.')
  await settled(page)

  const stored = await jsonOf<Location[]>(client, settingsBucket, 'Settings/locations.json')
  expect(stored.filter((entry) => entry.idProperty === 'CHI-07')).toHaveLength(2)
  expect(stored.find((entry) => entry.nameProperty === 'Chiricahua Spring')?.elevationProperty).toBe(2050)
  expect(stored.find((entry) => entry.nameProperty === 'Chiricahua Saddle')?.elevationProperty).toBe(2310)

  await context.close()
})
