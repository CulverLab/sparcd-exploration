// S6c — two administrators with the same list open, and the history entry that
// does not go through.
//
// Sam is made an administrator through the same JSON API the People screen
// calls; the app has no button for it, so the suite sets it up the honest way
// rather than pretending the screen offers it.

import { test, expect, type Page } from '@playwright/test'
import { join } from '../../src/api'
import {
  apiFor, collectionNamed, keysUnder, openSection, remember, s3, savedConnection, settled,
  signIn, signInAsAdmin, stack, textOf,
} from '../lib'

const AUDIT = 'Settings/audit/config/'
const CONFLICT = 'Someone else changed this list while you were editing. Reload before saving again.'
const STALE = 'Someone else changed this list. Reload to see their changes.'
const NO_HISTORY = 'Saved. Its history entry did not go through.'

const species = (page: Page) => page.getByRole('region', { name: 'Species' })
const locations = (page: Page) => page.getByRole('region', { name: 'Locations' })

test('a second administrator editing the same list, and a history entry that has to be retried', async ({ browser }) => {
  const { admin, settingsBucket, proxy } = stack()

  const invited = await apiFor(admin).addPerson({
    name: 'Sam Okafor', email: 'sam@example.org', admin: true,
  })
  const sam = await join(proxy, invited.invite.token)
  remember('sam', { ...sam, region: 'us-east-1', forcePathStyle: true, secure: false })

  // Jorge's tab loads the lists first, so what Sam does next happens behind it.
  const jorgeContext = await browser.newContext()
  const jorge = await signInAsAdmin(jorgeContext)
  const client = s3(await savedConnection(jorge))
  await openSection(jorge, 'Species')
  await expect(species(jorge).getByRole('button', { name: /Coyote/ })).toBeVisible()

  const samContext = await browser.newContext()
  const samPage = await samContext.newPage()
  await signIn(samPage, sam)
  const sidebar = samPage.getByRole('navigation', { name: 'Sections' }).first()
  await expect(sidebar.getByRole('button', { name: 'People', exact: true })).toBeVisible()
  await openSection(samPage, 'Species')
  await samPage.getByRole('region', { name: 'Species' }).getByRole('button', { name: /Coyote/ }).click()
  await samPage.getByRole('region', { name: 'Species' }).getByLabel('Common name').fill('Coyote (prairie wolf)')
  await samPage.getByRole('region', { name: 'Species' }).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(samPage.getByRole('region', { name: 'Species' }).getByRole('status')).toHaveText('Saved.')
  await settled(samPage)

  // Jorge is mid-edit on the same list and does not know.
  await species(jorge).getByRole('button', { name: /Gray Fox/ }).click()
  await species(jorge).getByLabel('Common name').fill('Gray Fox (draft)')
  await expect(species(jorge).getByText('1 species changed')).toBeVisible()

  // Saving the other list reloads both, so Sam's species version lands under
  // the open draft. The draft is kept and the banner says why.
  await openSection(jorge, 'Locations')
  const locationsPending = locations(jorge).getByText(/\d+ locations? changed/)
  await locations(jorge).getByRole('button', { name: /Rincon Tank/ }).first().click()
  await locations(jorge).getByLabel('Elevation').fill('1420')
  await locations(jorge).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(locationsPending).toHaveCount(0)
  await settled(jorge)

  await openSection(jorge, 'Species')
  await expect(species(jorge).getByText(STALE)).toBeVisible()
  await expect(species(jorge).getByLabel('Common name')).toHaveValue('Gray Fox (draft)')
  await expect(species(jorge).getByText('1 species changed')).toBeVisible()

  // Saving on top of it is refused, and still nothing is lost.
  await species(jorge).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(species(jorge).getByRole('status')).toHaveText(CONFLICT)
  await expect(species(jorge).getByLabel('Common name')).toHaveValue('Gray Fox (draft)')

  // Taking Sam's version is one button, and it is the draft that goes.
  await species(jorge).getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(species(jorge).getByText(STALE)).toHaveCount(0)
  await expect(species(jorge).getByText('1 species changed')).toHaveCount(0)
  await expect(species(jorge).getByRole('button', { name: /Coyote \(prairie wolf\)/ })).toBeVisible()

  // The same story on a collection's own details.
  await openSection(jorge, 'Collections')
  const collections = jorge.getByRole('region', { name: 'Collections' })
  await collections.getByRole('button', { name: /Research 1/ }).first().click()
  await collections.getByLabel('Description').fill('Jorge is halfway through a sentence')

  await openSection(samPage, 'Collections')
  const samCollections = samPage.getByRole('region', { name: 'Collections' })
  await samCollections.getByRole('button', { name: /Research 1/ }).first().click()
  await samCollections.getByLabel('Contact').fill('lab@culver.example (Sam)')
  await samCollections.getByRole('button', { name: /^Save collection/ }).click()
  await expect(samCollections.getByText('Saved.', { exact: true })).toBeVisible()
  await settled(samPage)
  await samContext.close()

  // Sam's change has to be in storage before Jorge reads it, or the reload
  // below hands him back exactly what he already had and proves nothing.
  const research = collectionNamed('Research 1')
  await expect.poll(() => textOf(client, research.bucket, `Collections/${research.uuid}/collection.json`))
    .toContain('lab@culver.example (Sam)')

  // Jorge's own save on the other screen is what fetches Sam's version.
  await openSection(jorge, 'Species')
  await species(jorge).getByRole('button', { name: /Coati/ }).first().click()
  await species(jorge).getByLabel('Genus').fill('Nasua ')
  await species(jorge).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(species(jorge).getByRole('status')).toHaveText('Saved.')
  await settled(jorge)

  await openSection(jorge, 'Collections')
  await expect(collections.getByText('Someone else changed this collection. Reload to see their changes.'))
    .toBeVisible({ timeout: 30_000 })
  await expect(collections.getByLabel('Description')).toHaveValue('Jorge is halfway through a sentence')
  await collections.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(collections.getByText('Someone else changed this collection. Reload to see their changes.')).toHaveCount(0)
  await expect(collections.getByLabel('Contact')).toHaveValue('lab@culver.example (Sam)')
  await openSection(jorge, 'Species')

  // The list is saved before its history entry is written, so a history entry
  // that fails must not be quietly dropped. Only the harness breaks it.
  const before = (await keysUnder(client, settingsBucket, AUDIT)).filter((key) => key.endsWith('.applied.json'))
  await jorge.route('**/*.applied.json', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/xml',
      body: '<Error><Code>AccessDenied</Code><Message>refused by the harness</Message></Error>',
    }))

  await species(jorge).getByRole('button', { name: /Black Bear/ }).click()
  await species(jorge).getByLabel('Common name').fill('Black Bear (American)')
  await species(jorge).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(species(jorge).getByRole('status')).toHaveText(NO_HISTORY)
  const retry = species(jorge).getByRole('button', { name: 'Retry history entry' })
  await expect(retry).toBeVisible()
  await expect(species(jorge).getByRole('button', { name: 'Save', exact: true })).toBeDisabled()

  // The list itself did land, whatever its history entry did.
  await expect.poll(() => textOf(client, settingsBucket, 'Settings/species.json'))
    .toContain('Black Bear (American)')

  await jorge.unroute('**/*.applied.json')
  await retry.click()
  await expect(species(jorge).getByRole('status')).toHaveText('History entry saved.')
  await expect(retry).toHaveCount(0)
  await settled(jorge)

  const after = (await keysUnder(client, settingsBucket, AUDIT)).filter((key) => key.endsWith('.applied.json'))
  expect(after.length).toBeGreaterThan(before.length)

  await jorgeContext.close()
})
