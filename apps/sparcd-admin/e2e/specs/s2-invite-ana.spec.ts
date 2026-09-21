// S2 — Ana is invited with "Can upload" on Sky Islands 2026, joins from her
// own browser, and can do exactly what that choice says: everything under that
// collection's Uploads/, nothing at all in Research 1.

import { test, expect } from '@playwright/test'
import {
  CompleteMultipartUploadCommand, CreateMultipartUploadCommand, GetObjectCommand,
  ListBucketsCommand, PutObjectCommand, UploadPartCommand,
} from '@aws-sdk/client-s3'
import {
  bytes, collectionNamed, openInvite, openSection, remember, s3, savedConnection,
  signInAsAdmin, stack, statusOf,
} from '../lib'

const USED = 'This link has already been used or has expired. Ask your administrator for a new one.'

test('Ana is invited, joins once, and can upload only where she was put', async ({ browser }) => {
  const sky = collectionNamed('Sky Islands 2026')
  const research = collectionNamed('Research 1')

  const adminContext = await browser.newContext()
  const admin = await signInAsAdmin(adminContext)
  await openSection(admin, 'People')
  await admin.getByRole('button', { name: 'Add a person' }).click()

  const form = admin.getByRole('region', { name: 'Add a person' })
  await form.getByLabel('Name').fill('Ana Morales')
  await form.getByLabel('Email').fill('ana@example.org')
  await form.getByLabel('Also add to a collection').selectOption({ label: 'Sky Islands 2026' })
  await form.getByRole('radio', { name: 'Can upload' }).check()
  await form.getByRole('button', { name: 'Add person' }).click()

  const link = form.getByLabel('Link to send')
  await expect(link).toBeVisible()
  await expect(admin.getByText("Send Ana this link. It works once and expires in 7 days.")).toBeVisible()
  const inviteUrl = await link.inputValue()
  expect(inviteUrl).toContain('join.html#e=')

  await form.getByRole('button', { name: 'Done' }).click()
  await admin.getByRole('button', { name: /Ana Morales/ }).first().click()
  await expect(admin.getByText('Sky Islands 2026 · Can upload')).toBeVisible()

  const ana = await openInvite(browser, inviteUrl)
  await expect(ana.page.getByRole('heading', { name: "Welcome, Ana Morales. You're all set." })).toBeVisible()

  const again = await openInvite(browser, inviteUrl)
  await expect(again.page.getByRole('alert')).toHaveText(USED)
  await again.context.close()

  const connection = await savedConnection(ana.page)
  remember('ana', connection)
  expect(connection.endpoint).toBe(stack().proxy)

  const client = s3(connection)
  const listed = await client.send(new ListBucketsCommand({}))
  expect((listed.Buckets ?? []).map((entry) => entry.Name).sort())
    .toEqual([sky.bucket, stack().settingsBucket].sort())

  const uploadKey = `Collections/${sky.uuid}/Uploads/${sky.stamp}/ANA_0001.JPG`
  expect(await statusOf(client.send(new PutObjectCommand({
    Bucket: sky.bucket, Key: uploadKey, Body: bytes('ana-upload'), ContentType: 'image/jpeg',
  })))).toBe(200)

  // The uploader's own path for a large photo: three parts, completed.
  const multipartKey = `Collections/${sky.uuid}/Uploads/${sky.stamp}/ANA_BIG.JPG`
  const created = await client.send(new CreateMultipartUploadCommand({
    Bucket: sky.bucket, Key: multipartKey, ContentType: 'image/jpeg',
  }))
  const part = (fill: number, size: number) => Buffer.alloc(size, fill)
  const parts = [part(1, 5 * 1024 * 1024), part(2, 5 * 1024 * 1024), part(3, 1024)]
  const etags = []
  for (const [index, body] of parts.entries()) {
    const uploaded = await client.send(new UploadPartCommand({
      Bucket: sky.bucket, Key: multipartKey, UploadId: created.UploadId, PartNumber: index + 1, Body: body,
    }))
    etags.push({ ETag: uploaded.ETag, PartNumber: index + 1 })
  }
  expect(await statusOf(client.send(new CompleteMultipartUploadCommand({
    Bucket: sky.bucket, Key: multipartKey, UploadId: created.UploadId,
    MultipartUpload: { Parts: etags },
  })))).toBe(200)

  // One real download, so the Activity screen has something of Ana's to show.
  const media = `Collections/${sky.uuid}/Uploads/${sky.stamp}/IMG_0412.JPG`
  expect(await statusOf(client.send(new GetObjectCommand({ Bucket: sky.bucket, Key: media })))).toBe(200)
  remember('anaDownload', { bucket: sky.bucket, key: media, file: 'IMG_0412.JPG' })

  const otherMedia = `Collections/${research.uuid}/Uploads/${research.stamp}/IMG_1190.JPG`
  expect(await statusOf(client.send(new GetObjectCommand({ Bucket: research.bucket, Key: otherMedia })))).toBe(403)
  expect(await statusOf(client.send(new PutObjectCommand({
    Bucket: research.bucket,
    Key: `Collections/${research.uuid}/Uploads/${research.stamp}/ANA_SNEAK.JPG`,
    Body: bytes('nope'),
  })))).toBe(403)

  await ana.context.close()
  await adminContext.close()
})
