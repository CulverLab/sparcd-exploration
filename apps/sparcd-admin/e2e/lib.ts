// Shared scaffolding for the scenarios: the running stack, the small amount of
// state one scenario hands the next, signing in as a person, and the SDK client
// used to check what that person can actually do in storage.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { S3Client } from '@aws-sdk/client-s3'
import type { Page, BrowserContext, Browser } from '@playwright/test'
import { expect } from '@playwright/test'

const STATE = fileURLToPath(new URL('./.state.json', import.meta.url))
const DESCRIPTOR = fileURLToPath(new URL('./.stack.json', import.meta.url))
export const SHOTS = fileURLToPath(new URL('./shots', import.meta.url))

export type Connection = {
  endpoint: string
  region: string
  accessKey: string
  secretKey: string
  forcePathStyle: boolean
  secure: boolean
}

export type Stack = {
  mode: string
  upstream: string
  namespace: string
  proxy: string
  admin: { endpoint: string; accessKey: string; secretKey: string; name: string; email: string }
  settingsBucket: string
  collections: { bucket: string; uuid: string; stamp: string; name: string }[]
  canary: { bucket: string; key: string }
}

export const stack = (): Stack => JSON.parse(readFileSync(DESCRIPTOR, 'utf8'))

export const collectionNamed = (name: string) => {
  const found = stack().collections.find((entry) => entry.name === name)
  if (!found) throw new Error(`no seeded collection named ${name}`)
  return found
}

type State = Record<string, unknown>

const readState = (): State => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {})

export function remember(key: string, value: unknown) {
  writeFileSync(STATE, `${JSON.stringify({ ...readState(), [key]: value }, null, 2)}\n`)
}

export function recall<T>(key: string): T {
  const state = readState()
  if (!(key in state)) throw new Error(`nothing remembered under "${key}" — run the whole suite in order`)
  return state[key] as T
}

/** The connection this tab is signed in with, secret included. */
export async function savedConnection(page: Page): Promise<Connection> {
  const raw = await page.evaluate(() => sessionStorage.getItem('sparcd-connection-tab'))
  if (!raw) throw new Error('this context has no saved connection')
  return JSON.parse(raw) as Connection
}

/** Sign in through the real form, the way an administrator does. */
export async function signIn(page: Page, credentials: { endpoint: string; accessKey: string; secretKey: string }) {
  await page.goto('index.html')
  await page.locator('#endpoint').fill(credentials.endpoint)
  await page.locator('#accessKey').fill(credentials.accessKey)
  await page.locator('#secretKey').fill(credentials.secretKey)
  await page.getByRole('button', { name: 'Connect' }).click()
}

export async function signInAsAdmin(context: BrowserContext) {
  const page = await context.newPage()
  const { admin } = stack()
  await signIn(page, admin)
  await expect(page.getByRole('navigation', { name: 'Sections' }).first()).toBeVisible()
  return page
}

export const section = (page: Page, name: string) =>
  page.getByRole('navigation', { name: 'Sections' }).first().getByRole('button', { name, exact: true })

export async function openSection(page: Page, name: string) {
  await section(page, name).click()
}

/** Open an invite link in a context of its own, as the invited person would. */
export async function openInvite(browser: Browser, link: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(link)
  return { context, page }
}

export function s3(connection: Connection) {
  return new S3Client({
    endpoint: connection.endpoint,
    region: connection.region,
    forcePathStyle: true,
    credentials: { accessKeyId: connection.accessKey, secretAccessKey: connection.secretKey },
    // The flexible-checksum default frames bodies as aws-chunked with a
    // streaming payload hash, which the proxy refuses by design.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })
}

/** The HTTP status an SDK call ended on, however it ended. */
export async function statusOf(call: Promise<unknown>): Promise<number> {
  try {
    const result = (await call) as { $metadata?: { httpStatusCode?: number } }
    return result?.$metadata?.httpStatusCode ?? 200
  } catch (cause) {
    return (cause as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode ?? 0
  }
}

export const bytes = (label: string) => Buffer.from(`${label}\n`, 'utf8')

export async function shot(page: Page, folder: string, name: string) {
  mkdirSync(`${SHOTS}/${folder}`, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  // Let the last render settle, or the same screen photographs differently on
  // every run.
  await page.waitForTimeout(250)
  await page.screenshot({
    path: `${SHOTS}/${folder}/${name}.png`, fullPage: true, animations: 'disabled',
  })
}

/** A viewport a phone would have, for the second set of screenshots. */
export const PHONE = { width: 390, height: 844 }

/**
 * Wait out the reload a save kicks off. It re-reads every list and then closes
 * whatever record was open, so anything clicked before it lands is thrown away.
 */
export const settled = (page: Page) => page.waitForLoadState('networkidle')

