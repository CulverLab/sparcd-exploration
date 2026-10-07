// S9 — Ana can upload, so she has a login; she is not an administrator, so the
// Admin app has to say so in one plain screen rather than a storage error.

import { test, expect } from '@playwright/test'
import { recall, signIn, type Connection } from '../lib'

test('a login that is not an administrator gets the plain screen', async ({ browser }) => {
  const ana = recall<Connection>('ana')

  const context = await browser.newContext()
  const page = await context.newPage()
  await signIn(page, { endpoint: ana.endpoint, accessKey: ana.accessKey, secretKey: ana.secretKey })

  await expect(page.getByRole('heading', { name: "This login can't manage SPARC'd." })).toBeVisible()
  await expect(page.getByText('Ask an administrator for access.')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Sections' })).toHaveCount(0)

  // The one button on the screen is the way back off it.
  await page.getByRole('button', { name: 'Logout' }).click()
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toBeVisible()

  await context.close()
})
