// Every screen of the Admin app, and the two apps beside it, in a state worth
// looking at, at a desktop size and a phone size, at twice the pixel density.
// These are read by a person, so the states are the ones the apps are actually
// used in: lists with a record open, a collection with its people and the
// checklist behind them, an invite with the link showing, activity narrowed
// down, and a member signed in to the Uploader and the Tagger.

import { test, expect, type Browser, type Page } from '@playwright/test'
import {
  PHONE, SHOT_SCALE, TAGGER, UPLOADER, openInvite, openSection, recall, shot, signIn,
  signInAsAdmin, signInHere, stack, type Connection,
} from '../lib'

const region = (page: Page, name: string) => page.getByRole('region', { name })

async function tour(browser: Browser, folder: string, viewport: { width: number; height: number }, who: string) {
  const options = { viewport, deviceScaleFactor: SHOT_SCALE }
  const context = await browser.newContext(options)

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
  await expect(region(page, 'Locations').getByLabel('Protected location')).toBeChecked()
  await shot(page, folder, 'locations')

  await openSection(page, 'Collections')
  const collections = region(page, 'Collections')
  await collections.getByRole('button', { name: /Sky Islands 2026/ }).first().click()
  await expect(collections.getByLabel('Organization')).toBeVisible()
  await expect(region(page, 'People in this collection').getByRole('table')).toBeVisible()
  await shot(page, folder, 'collections-members')

  await collections.getByText('Species used in this collection').click()
  await expect(collections.getByText(/\d+ of \d+ species used here\./)).toBeVisible()
  await shot(page, folder, 'collections-checklist')
  await collections.getByText('Species used in this collection').click()

  await openSection(page, 'People')
  await region(page, 'People').getByRole('button', { name: /Luis Park/ }).first().click()
  await expect(page.getByRole('button', { name: 'Pause access' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add to a collection' })).toBeVisible()
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

  // Narrowed down, because that is how the screen is used: one kind of thing,
  // one collection, rather than everything at once.
  await openSection(page, 'Activity')
  const activity = region(page, 'Activity')
  await activity.getByRole('button', { name: 'Uploads' }).click()
  await activity.getByLabel('Collection', { exact: true }).first().selectOption({ label: 'Sky Islands 2026' })
  await expect(activity.getByRole('listitem').first()).toBeVisible()
  await shot(page, folder, 'activity')

  await openSection(page, 'Settings')
  await expect(page.getByLabel('Your name')).toBeVisible()
  await shot(page, folder, 'settings')

  const joined = await openInvite(browser, invite, options)
  await expect(joined.page.getByRole('heading', { name: new RegExp(`Welcome, ${who}`) })).toBeVisible()
  await shot(joined.page, folder, 'join-welcome')
  await joined.context.close()

  const ana = recall<Connection>('ana')
  const outsider = await browser.newContext(options)
  const outsiderPage = await outsider.newPage()
  await signIn(outsiderPage, { endpoint: ana.endpoint, accessKey: ana.accessKey, secretKey: ana.secretKey })
  await expect(outsiderPage.getByRole('heading', { name: "This login can't manage SPARC'd." })).toBeVisible()
  await shot(outsiderPage, folder, 'not-an-administrator')
  await outsider.close()

  await context.close()
}

/** The two apps the same login opens, each signed in as a member of one collection. */
async function siblings(browser: Browser, folder: string, viewport: { width: number; height: number }) {
  const options = { viewport, deviceScaleFactor: SHOT_SCALE }

  const uploaderContext = await browser.newContext(options)
  const uploader = await uploaderContext.newPage()
  await uploader.goto(UPLOADER)
  await signInHere(uploader, recall<Connection>('nadia'))
  await expect(uploader.getByRole('button', { name: 'Logout' })).toBeVisible({ timeout: 30_000 })
  await shot(uploader, folder, 'uploader-signed-in')
  await uploaderContext.close()

  const taggerContext = await browser.newContext(options)
  const tagger = await taggerContext.newPage()
  await tagger.goto(TAGGER)
  await signInHere(tagger, recall<Connection>('rae'))
  const sections = tagger.locator('nav[aria-label="Sections"]:visible')
  await expect(sections.getByRole('button', { name: 'Browse' })).toBeVisible({ timeout: 30_000 })
  await tagger.locator('aside').getByRole('button').filter({ hasText: 'Sky Islands 2026' }).first().click()
  await expect(tagger.getByRole('heading', { name: /Uploads in Sky Islands 2026/ })).toBeVisible({ timeout: 30_000 })
  await expect(tagger.locator('button').filter({ hasText: 'nadia-rossi' }).first()).toBeVisible({ timeout: 60_000 })
  await shot(tagger, folder, 'tagger-signed-in')
  await taggerContext.close()
}

test('every screen, at a desktop size', async ({ browser }) => {
  expect(stack().collections.length).toBe(2)
  await tour(browser, 'desktop', { width: 1440, height: 900 }, 'Marta Ruiz')
})

test('every screen, at a phone size', async ({ browser }) => {
  await tour(browser, 'phone', PHONE, 'Tomás Vega')
})

test('the Uploader and the Tagger, at both sizes', async ({ browser }) => {
  await siblings(browser, 'desktop', { width: 1440, height: 900 })
  await siblings(browser, 'phone', PHONE)
})
