// S7 — the Activity screen. What people did, in sentences an administrator
// can read, and the one question the screen exists to answer.

import { test, expect, type Page } from '@playwright/test'
import { openSection, recall, signInAsAdmin } from '../lib'

const activity = (page: Page) => page.getByRole('region', { name: 'Activity' })

test('activity reads back as sentences, and the download lookup names Ana', async ({ browser }) => {
  const download = recall<{ file: string }>('anaDownload')

  const context = await browser.newContext()
  const page = await signInAsAdmin(context)
  await openSection(page, 'Activity')

  await expect(activity(page).getByRole('listitem')
    .filter({ hasText: `Ana Morales downloaded ${download.file} from Sky Islands 2026` }))
    .toHaveCount(1)

  await activity(page).getByRole('button', { name: 'Problems' }).click()
  const problems = activity(page).getByRole('listitem')
  // Both at once, or a list that has not refreshed yet passes the first half
  // and the emptied list passes the second.
  await expect(async () => {
    await expect(problems.filter({ hasText: "Luis Park tried to open something they don't have access to in Sky Islands 2026" }).first())
      .toBeVisible({ timeout: 1000 })
    await expect(problems.filter({ hasText: 'downloaded' })).toHaveCount(0, { timeout: 1000 })
  }).toPass({ timeout: 15000 })
  await activity(page).getByRole('button', { name: 'Problems' }).click()

  await activity(page).getByLabel('Collection', { exact: true }).nth(1)
    .selectOption({ label: 'Sky Islands 2026' })
  await activity(page).getByLabel('Image name').fill(download.file)
  await activity(page).getByRole('button', { name: 'Look it up' }).click()
  await expect(activity(page).getByText(new RegExp(`${download.file} from Sky Islands 2026 was downloaded by Ana Morales`)))
    .toBeVisible()

  await context.close()
})
