// Every screen of the Admin app, in a state worth looking at, at a desktop
// size and a phone size. These are read by a person, so the states are the
// ones the app is actually used in: lists with a record open, a collection
// with its people, an invite with the link showing.

import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  PHONE, openInvite, openSection, recall, shot, signIn, signInAsAdmin, stack,
  type Connection,
} from '../lib'

const region = (page: Page, name: string) => page.getByRole('region', { name })

async function tour(browser: Browser, folder: string, viewport: { width: number; height: number }, who: string) {
  const context = await browser.newContext({ viewport })

  const cold = await context.newPage()
  await cold.goto('index.html')
  await expect(cold.getByRole('button', { name: 'Connect' })).toBeVisible()
  await shot(cold, folder, 'login')
  await cold.close()

  const page = await signInAsAdmin(context)

  await openSection(page, 'Species')
  await region(page, 'Species').getByRole('button', { name: /Bobcat/ }).click()
  await expect(region(page, 'Species').getByLabel('Scientific name')).toBeVisible()
  await shot(page, folder, 'species')

  await openSection(page, 'Locations')
  await region(page, 'Locations').getByRole('button', { name: /Santa Rita Wash/ }).click()
  await expect(region(page, 'Locations').getByLabel('Latitude')).toBeVisible()
  await shot(page, folder, 'locations')

  await openSection(page, 'Collections')
  await region(page, 'Collections').getByRole('button', { name: /Sky Islands 2026/ }).first().click()
  await expect(region(page, 'People in this collection').getByRole('table')).toBeVisible()
  await shot(page, folder, 'collections-members')

  await region(page, 'Collections').getByText('Species used in this collection').click()
  await expect(region(page, 'Collections').getByLabel('Search species')).toBeVisible()
  await shot(page, folder, 'collections-checklist')

  await openSection(page, 'People')
  await region(page, 'People').getByRole('button', { name: /Luis Park/ }).first().click()
  await expect(page.getByRole('button', { name: 'Pause access' })).toBeVisible()
  await shot(page, folder, 'people')

  await page.getByRole('button', { name: 'Add a person' }).click()
  const form = region(page, 'Add a person')
  await form.getByLabel('Name').fill(who)
  await form.getByLabel('Email').fill(`${who.split(' ')[0].toLowerCase()}@example.org`)
  await form.getByLabel('Also add to a collection').selectOption({ label: 'Sky Islands 2026' })
  await form.getByRole('radio', { name: 'Can identify' }).check()
  await form.getByRole('button', { name: 'Add person' }).click()
  await expect(form.getByLabel('Link to send')).toBeVisible()
  await shot(page, folder, 'add-a-person')
  const invite = await form.getByLabel('Link to send').inputValue()

  await openSection(page, 'Activity')
  await expect(region(page, 'Activity').getByRole('listitem').first()).toBeVisible()
  await shot(page, folder, 'activity')

  await openSection(page, 'Settings')
  await expect(page.getByLabel('Your name')).toBeVisible()
  await shot(page, folder, 'settings')

  const joined = await openInvite(browser, invite)
  await joined.page.setViewportSize(viewport)
  await expect(joined.page.getByRole('heading', { name: new RegExp(`Welcome, ${who}`) })).toBeVisible()
  await shot(joined.page, folder, 'join-welcome')
  await joined.context.close()

  const ana = recall<Connection>('ana')
  const outsider = await browser.newContext({ viewport })
  const outsiderPage = await outsider.newPage()
  await signIn(outsiderPage, { endpoint: ana.endpoint, accessKey: ana.accessKey, secretKey: ana.secretKey })
  await expect(outsiderPage.getByRole('heading', { name: "This login can't manage SPARC'd." })).toBeVisible()
  await shot(outsiderPage, folder, 'not-an-administrator')
  await outsider.close()

  await context.close()
}

test('every screen, at a desktop size', async ({ browser }) => {
  expect(stack().collections.length).toBe(2)
  await tour(browser, 'desktop', { width: 1440, height: 900 }, 'Marta Ruiz')
})

test('every screen, at a phone size', async ({ browser }) => {
  await tour(browser, 'phone', PHONE, 'Tomás Vega')
})
