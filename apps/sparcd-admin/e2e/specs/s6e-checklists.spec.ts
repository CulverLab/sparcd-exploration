// S6e — the two checklists inside a collection: which of the shared species and
// locations it uses. The count sentence, the rule that it cannot be emptied,
// undo, the entries the shared list has moved on from, and what the ticks look
// like once they are in storage.

import { test, expect, type Page, type Locator } from '@playwright/test'
import {
  collectionNamed, jsonOf, openSection, s3, savedConnection, settled, signInAsAdmin, stack,
} from '../lib'

type Entry = Record<string, unknown>

const collections = (page: Page) => page.getByRole('region', { name: 'Collections' })

/** The open panel behind one of the two summaries. */
const panel = (page: Page, kind: 'Species' | 'Locations') =>
  collections(page).locator('details', { has: page.getByText(`${kind} used in this collection`) }).first()

const rowFor = (where: Locator, label: string) => where.getByRole('listitem').filter({ hasText: label }).first()

test('the species and locations a collection uses', async ({ browser }) => {
  const { settingsBucket } = stack()
  const sky = collectionNamed('Sky Islands 2026')
  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  const client = s3(await savedConnection(page))

  const sharedSpecies = await jsonOf<Entry[]>(client, settingsBucket, 'Settings/species.json')
  const activeSpecies = sharedSpecies.filter((entry) => entry.retired !== true).length
  const usedSpecies = (await jsonOf<Entry[]>(client, sky.bucket, `Collections/${sky.uuid}/species.json`)).length

  await openSection(page, 'Collections')
  await collections(page).getByRole('button', { name: /Sky Islands 2026/ }).first().click()

  // ---- species ----------------------------------------------------------
  await collections(page).getByText('Species used in this collection').click()
  const species = panel(page, 'Species')
  const speciesCount = species.getByText(/\d+ of \d+ species used here\./)
  await expect(speciesCount).toHaveText(`${usedSpecies} of ${activeSpecies} species used here.`)

  // A species the shared list has retired, still used here, keeps its row and
  // says what it is rather than vanishing from under the collection.
  await expect(rowFor(species, 'Javelina')).toContainText('Retired')
  await expect(rowFor(species, 'Javelina').getByRole('checkbox')).toBeChecked()

  const speciesSearch = species.getByLabel('Search species')
  await speciesSearch.fill('Ringtail')
  await expect(species.getByRole('listitem')).toHaveCount(1)
  await speciesSearch.fill('zzz')
  await expect(species.getByText('Nothing matches that search.')).toBeVisible()
  await speciesSearch.fill('')

  // It cannot be emptied, and the reason is next to the button that is off.
  const speciesSave = species.getByRole('button', { name: 'Save species' })
  // A plain click, not `uncheck`: a retired entry's row is only there because
  // the collection still uses it, so unticking it takes the row with it.
  const ticked = species.getByRole('checkbox', { checked: true })
  for (let left = await ticked.count(); left > 0; left = await ticked.count()) {
    await ticked.first().click()
    await expect(ticked).toHaveCount(left - 1)
  }
  await expect(species.getByRole('alert')).toHaveText('Keep at least one species in this collection.')
  await expect(speciesSave).toBeDisabled()
  await expect(speciesCount).toHaveText(`0 of ${activeSpecies} species used here.`)

  // Undo is one step back, and it puts the last tick returned rather than
  // turning into a redo.
  await species.getByRole('button', { name: 'Undo' }).click()
  await expect(speciesCount).toHaveText(`1 of ${activeSpecies} species used here.`)
  await expect(species.getByRole('alert')).toHaveCount(0)
  await expect(species.getByRole('button', { name: 'Undo' })).toHaveCount(0)

  // Re-opening the collection drops what is left of the draft.
  await collections(page).getByRole('button', { name: /Sky Islands 2026/ }).first().click()
  await expect(speciesCount).toHaveText(`${usedSpecies} of ${activeSpecies} species used here.`)

  await rowFor(species, 'Ringtail').getByRole('checkbox').check()
  await expect(speciesCount).toHaveText(`${usedSpecies + 1} of ${activeSpecies} species used here.`)
  await speciesSave.click()
  await expect(collections(page).getByText('Saved the species used in this collection.')).toBeVisible()
  await settled(page)

  await expect.poll(async () =>
    (await jsonOf<Entry[]>(client, sky.bucket, `Collections/${sky.uuid}/species.json`))
      .map((entry) => entry.scientificName))
    .toContain('Bassariscus astutus')

  // ---- locations --------------------------------------------------------
  await collections(page).getByText('Locations used in this collection').click()
  const locations = panel(page, 'Locations')

  // The shared list has moved on under this collection since S6b: one site got
  // a new elevation, and another's ID was moved somewhere free.
  const outdated = locations.getByText(/\d+ entr(y is|ies are) out of date with the shared list\./)
  await expect(outdated).toBeVisible()
  const before = Number((await outdated.textContent())!.match(/\d+/)![0])
  expect(before).toBeGreaterThan(0)

  await expect(rowFor(locations, 'Bear Canyon Lower')).toContainText('Not in the shared list')

  await locations.getByText('Review one by one').click()
  await locations.getByRole('listitem').filter({ hasText: 'Chiricahua Spring' })
    .getByRole('button', { name: 'Update' }).first().click()
  if (before > 1) {
    await expect(outdated).toHaveText(
      before - 1 === 1 ? '1 entry is out of date with the shared list.' : `${before - 1} entries are out of date with the shared list.`)
    await locations.getByRole('button', { name: 'Update them' }).click()
  }
  await expect(outdated).toHaveCount(0)

  await locations.getByRole('button', { name: 'Save locations' }).click()
  await expect(collections(page).getByText('Saved the locations used in this collection.')).toBeVisible()
  await settled(page)

  await expect.poll(async () =>
    (await jsonOf<Entry[]>(client, sky.bucket, `Collections/${sky.uuid}/locations.json`))
      .find((entry) => entry.nameProperty === 'Chiricahua Spring')?.elevationProperty).toBe(2050)

  await context.close()
})
