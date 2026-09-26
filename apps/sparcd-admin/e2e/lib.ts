// Shared scaffolding for the scenarios: the running stack, the small amount of
// state one scenario hands the next, signing in as a person, and the SDK client
// used to check what that person can actually do in storage.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import type { Page, BrowserContext, Browser } from '@playwright/test'
import { expect } from '@playwright/test'
import { createApi } from '../src/api'

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

/** The two sibling apps the same people sign in to with the same login. */
export const UPLOADER = `http://127.0.0.1:${process.env.E2E_UPLOADER_PORT ?? 5413}/sparcd-exploration/uploader/`
export const TAGGER = `http://127.0.0.1:${process.env.E2E_TAGGER_PORT ?? 5414}/sparcd-exploration/tagger/`

/**
 * Sign in to whichever app is open. All three ship the same three-field form,
 * so one person's login works the same everywhere.
 */
export async function signInHere(page: Page, credentials: { endpoint: string; accessKey: string; secretKey: string }) {
  await page.locator('#endpoint').fill(credentials.endpoint)
  await page.locator('#accessKey').fill(credentials.accessKey)
  await page.locator('#secretKey').fill(credentials.secretKey)
  await page.getByRole('button', { name: 'Connect', exact: true }).click()
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

/**
 * Screenshots are taken at twice the pixel density, so a 1440px-wide desktop
 * picture is a 2880px file — sharp enough to read on the screen it is reviewed
 * on rather than a blurry thumbnail.
 */
export const SHOT_SCALE = 2

/** Open an invite link in a context of its own, as the invited person would. */
export async function openInvite(browser: Browser, link: string, options: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext(options)
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
    // Contract 1.1 refuses any `x-amz-*` header outside its allowlist rather
    // than stripping it, and the flexible-checksum default adds several while
    // framing the body as aws-chunked. Asking for checksums only where the
    // API needs them keeps a request to headers the proxy will forward.
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

/** The whole of one stored object, as text. */
export async function textOf(client: S3Client, bucket: string, key: string) {
  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return got.Body!.transformToString()
}

export const jsonOf = async <T>(client: S3Client, bucket: string, key: string): Promise<T> =>
  JSON.parse(await textOf(client, bucket, key)) as T

export async function keysUnder(client: S3Client, bucket: string, prefix: string) {
  const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix }))
  return (listed.Contents ?? []).map((entry) => entry.Key!).sort()
}

/**
 * The same JSON API the app's own screens call, signed with one person's key.
 * The suite uses it where the app has no button for something — inviting a
 * second administrator, for one — so the scenario can still be set up honestly.
 */
export const apiFor = (connection: { endpoint: string; accessKey: string; secretKey: string; region?: string }) =>
  createApi({
    endpoint: connection.endpoint,
    region: connection.region ?? 'us-east-1',
    accessKey: connection.accessKey,
    secretKey: connection.secretKey,
    forcePathStyle: true,
    secure: false,
  } as never)

export async function shot(page: Page, folder: string, name: string) {
  mkdirSync(`${SHOTS}/${folder}`, { recursive: true })
  await page.evaluate(() => document.fonts.ready)
  // Nothing a phone can reach may push the page sideways. Every screen worth a
  // picture goes through here, so this is where the rule is checked.
  if (page.viewportSize()?.width === PHONE.width) {
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${name} scrolls sideways at ${PHONE.width}px`).toBeLessThanOrEqual(0)
  }
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
 * Wait out the reload a save kicks off. The record stays open across it, but
 * the controls are held until it lands.
 */
export const settled = (page: Page) => page.waitForLoadState('networkidle')

