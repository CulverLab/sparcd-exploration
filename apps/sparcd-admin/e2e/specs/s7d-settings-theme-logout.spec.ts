// S7d — the three things in the chrome rather than in a list: the name every
// change is recorded under, the light/dark switch, and the way out.

import { test, expect, type Page } from '@playwright/test'
import { jsonOf, keysUnder, openSection, s3, savedConnection, settled, signInAsAdmin, stack } from '../lib'

const EVENING = 'Jorge Delgado (evening shift)'
const NEW_NAME = 'Coati (chulo)'

const species = (page: Page) => page.getByRole('region', { name: 'Species' })

test('the name on a change, the theme switch and logging out', async ({ browser }) => {
  const { settingsBucket, admin } = stack()
  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  const client = s3(await savedConnection(page))

  await openSection(page, 'Settings')
  const name = page.getByLabel('Your name')
  await expect(name).toHaveValue('Jorge Delgado')

  // With no name at all the login ID is what would be recorded, and the screen
  // says so rather than letting it happen quietly.
  await name.fill('')
  await expect(page.getByRole('alert'))
    .toHaveText(`Without a name, changes are recorded under the login ID ${admin.accessKey}.`)

  await name.fill(EVENING)
  await expect(page.getByText(EVENING).first()).toBeVisible()

  // And it is that name, not the login, that the history entry carries.
  await openSection(page, 'Species')
  await species(page).getByRole('button', { name: /Coati/ }).first().click()
  await species(page).getByLabel('Common name').fill(NEW_NAME)
  await species(page).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(species(page).getByRole('status')).toHaveText('Saved.')
  await settled(page)

  await expect.poll(async () => {
    const keys = (await keysUnder(client, settingsBucket, 'Settings/audit/config/'))
      .filter((key) => key.endsWith('.prepared.json'))
    const events = await Promise.all(keys.map((key) =>
      jsonOf<{ actor: string; action: string; after: { name?: string }[] }>(client, settingsBucket, key)))
    return events.some((event) =>
      event.actor === EVENING &&
      event.action === 'species.updated' &&
      event.after.some((entry) => entry.name === NEW_NAME))
  }, { timeout: 15000 }).toBe(true)

  // Light and dark, and the button says which way it goes next.
  const dark = page.getByRole('button', { name: 'Switch to dark' })
  await expect(page.locator('html')).not.toHaveClass(/dark/)
  await dark.click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'Switch to light' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  // Logging out puts the sign-in form back, with nothing left signed in.
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('sparcd-connection-tab'))).toBeNull()

  await context.close()
})
