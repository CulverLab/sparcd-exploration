// S1 — the administrator signs in with the key `cli.mjs init` printed, and
// finds the shared lists and the two screens only an administrator gets.

import { test, expect } from '@playwright/test'
import { openSection, signIn, stack } from '../lib'

test('the administrator signs in and the seeded lists are there', async ({ page }) => {
  const { admin } = stack()

  await signIn(page, admin)

  const sidebar = page.getByRole('navigation', { name: 'Sections' }).first()
  await expect(sidebar).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'People', exact: true })).toBeVisible()
  await expect(sidebar.getByRole('button', { name: 'Activity', exact: true })).toBeVisible()
  await expect(page.getByText('Jorge Delgado').first()).toBeVisible()

  await openSection(page, 'Species')
  await expect(page.getByText('8 species in the list')).toBeVisible()
  await expect(page.getByRole('button', { name: /Mountain Lion/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Puma concolor/ })).toBeVisible()

  await openSection(page, 'Locations')
  await expect(page.getByText('8 locations in the list')).toBeVisible()
  await expect(page.getByRole('button', { name: /Bear Canyon Upper/ })).toBeVisible()
  // The legacy shape the list has to survive: one ID on two different sites.
  await expect(page.getByRole('button', { name: /CHI-07/ })).toHaveCount(2)
})
