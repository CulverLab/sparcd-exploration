// S8 — the bucket outside the namespace. Nobody reaches it, nobody is told it
// exists, and it comes out of the run byte for byte as it went in.

import { test, expect } from '@playwright/test'
import {
  CreateMultipartUploadCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand,
  ListBucketsCommand, ListObjectsV2Command, PutObjectCommand,
} from '@aws-sdk/client-s3'
// @ts-expect-error — plain JavaScript, shared with the proxy.
import { makeUpstream } from '../../../sparcd-shard-proxy/access/upstream.mjs'
import { CANARY_BODY } from '../seed.mjs'
import {
  bytes, openSection, recall, s3, savedConnection, signInAsAdmin, stack, statusOf,
  type Connection,
} from '../lib'

const SECTIONS = ['Species', 'Locations', 'Collections', 'People', 'Activity', 'Settings']

test('the canary is invisible, unreachable and unchanged', async ({ browser }) => {
  const { canary, settingsBucket, collections } = stack()

  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  const admin = await savedConnection(page)

  const everyone: [string, Connection][] = [
    ['Jorge Delgado', admin],
    ['Ana Morales', recall<Connection>('ana')],
    ['Luis Park', recall<Connection>('luis')],
    ['Priya Nair', recall<Connection>('priya')],
  ]

  for (const [who, connection] of everyone) {
    const client = s3(connection)
    const listed = await client.send(new ListBucketsCommand({}))
    const names = (listed.Buckets ?? []).map((entry) => entry.Name!)
    expect(names, `${who} must not be told the canary bucket exists`).not.toContain(canary.bucket)
    expect(names.every((name) => name === settingsBucket || collections.some((c) => c.bucket === name)))
      .toBe(true)

    const verbs = {
      GetObject: new GetObjectCommand({ Bucket: canary.bucket, Key: canary.key }),
      HeadObject: new HeadObjectCommand({ Bucket: canary.bucket, Key: canary.key }),
      PutObject: new PutObjectCommand({ Bucket: canary.bucket, Key: canary.key, Body: bytes('overwritten') }),
      DeleteObject: new DeleteObjectCommand({ Bucket: canary.bucket, Key: canary.key }),
      ListObjectsV2: new ListObjectsV2Command({ Bucket: canary.bucket }),
      CreateMultipartUpload: new CreateMultipartUploadCommand({ Bucket: canary.bucket, Key: canary.key }),
    }
    for (const [verb, command] of Object.entries(verbs)) {
      expect(await statusOf(client.send(command as never)), `${verb} as ${who}`).toBe(403)
    }
  }

  for (const name of SECTIONS) {
    await openSection(page, name)
    const shown = await page.locator('body').innerText()
    expect(shown.toLowerCase(), `the ${name} screen must never name the canary`).not.toContain('canary')
  }

  // The only way to see it at all is the credential the proxy never hands out.
  const root = makeUpstream({
    endpoint: stack().upstream,
    accessKeyId: process.env.E2E_S3_ACCESS_KEY_ID ?? 'admine2ekey',
    secretAccessKey: process.env.E2E_S3_SECRET_ACCESS_KEY ?? 'admine2esecret',
  })
  const stored = await root.get(canary.bucket, canary.key)
  expect(stored.text).toBe(CANARY_BODY)

  await context.close()
})
