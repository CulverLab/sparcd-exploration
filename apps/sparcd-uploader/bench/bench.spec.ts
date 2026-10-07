import { expect, test, type Page } from '@playwright/test';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MINIO_ORIGIN = 'http://127.0.0.1:19000';
const COLLECTION_UUID = '11111111-1111-1111-1111-111111111111';
const COLLECTION_BUCKET = `sparcd-${COLLECTION_UUID}`;
const METADATA = new Set(['deployments.csv', 'media.csv', 'observations.csv', 'UploadMeta.json', 'UploadComplete.json']);
const TOTAL_MEDIA_BYTES = 119_537_664;

function objectKey(urlString: string): string {
  const url = new URL(urlString);
  return decodeURIComponent(url.pathname).split('/').slice(2).join('/');
}

function isMetadata(urlString: string): boolean {
  return METADATA.has(objectKey(urlString).split('/').at(-1) ?? '');
}

async function loadFixtureFolder(page: Page): Promise<void> {
  const root = path.resolve('bench/.fixtures/bench-corpus');
  await page.locator('input[type="file"]').first().setInputFiles(root);
}

test('uploads the fixed corpus through the real app', async ({ page }) => {
  const runIndex = Number(process.env.BENCH_RUN_INDEX);
  const resultFile = process.env.BENCH_RESULT_FILE;
  if (!runIndex || !resultFile) throw new Error('BENCH_RUN_INDEX and BENCH_RESULT_FILE are required');

  let firstMediaRequestAt: number | undefined;
  let lastMediaHeadAt: number | undefined;
  let uploadCompleteAt: number | undefined;
  let uploadPrefix: string | undefined;
  const requestCounts = { mediaPut: 0, mediaHead: 0, mediaList: 0, multipartPart: 0, metadataPut: 0 };

  page.on('request', (request) => {
    if (!request.url().startsWith(MINIO_ORIGIN)) return;
    if (request.method() === 'OPTIONS') return;
    const url = new URL(request.url());
    const listedPrefix = url.searchParams.get('prefix') ?? '';
    if (
      request.method() === 'GET' &&
      url.searchParams.get('list-type') === '2' &&
      uploadPrefix !== undefined &&
      listedPrefix === `${uploadPrefix}/`
    ) {
      requestCounts.mediaList++;
    }
    const key = objectKey(request.url());
    if (!key.startsWith('Collections/')) return;
    const metadata = isMetadata(request.url());
    if (request.method() === 'PUT' && metadata) requestCounts.metadataPut++;
    if (request.method() === 'PUT' && !metadata && url.searchParams.has('partNumber')) requestCounts.multipartPart++;
    if (request.method() === 'PUT' && !metadata && !url.searchParams.has('partNumber')) requestCounts.mediaPut++;
    if (request.method() === 'HEAD' && !metadata) requestCounts.mediaHead++;
    if (!metadata && firstMediaRequestAt === undefined && (request.method() === 'PUT' || url.searchParams.has('uploads'))) {
      firstMediaRequestAt = performance.now();
      // Media keys nest the picked folder (Collections/<uuid>/Uploads/<stamp>_<slug>/bench-corpus/...);
      // metadata sits at the upload path itself, so keep exactly its four segments.
      uploadPrefix = key.split('/').slice(0, 4).join('/');
    }
  });
  page.on('response', (response) => {
    if (!response.url().startsWith(MINIO_ORIGIN)) return;
    if (response.request().method() === 'HEAD' && !isMetadata(response.url()) && objectKey(response.url()).startsWith('Collections/')) {
      lastMediaHeadAt = performance.now();
    }
    if (response.request().method() === 'PUT' && objectKey(response.url()).endsWith('/UploadComplete.json')) {
      uploadCompleteAt = performance.now();
    }
  });

  await page.goto('.');
  await page.fill('#endpoint', MINIO_ORIGIN);
  await page.fill('#accessKey', 'minioadmin');
  await page.fill('#secretKey', 'minioadmin');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

  const folderAcceptedAt = performance.now();
  await loadFixtureFolder(page);
  // Inspect keeps the virtualised file pane folded by default; the summary
  // and its toggle are the stable readiness surface for the benchmark.
  await expect(page.getByRole('button', { name: 'Show files' })).toBeVisible();
  await expect(page.getByText(/362 of 362 files processed/).first()).toBeVisible();
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return !/\d+\s+processing/.test(text) && !text.includes('Processing…') && !text.includes('Queued');
  }, undefined, { timeout: 120_000 });
  const inspectedAt = performance.now();

  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Target collection' })).toBeVisible();
  await expect(page.locator('button[aria-haspopup="listbox"]').first()).toBeVisible();
  const deployment = page.locator('button[aria-haspopup="listbox"]').nth(1);
  await deployment.click();
  await page.locator('ul[role="listbox"] li[role="option"]').filter({ hasText: 'Bear Canyon' }).first().click();
  await page.getByPlaceholder('e.g. John Doe').first().fill(`Perf Runner ${runIndex}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Upload', exact: true })).toBeVisible();
  const dryRun = page.getByRole('checkbox');
  if (await dryRun.isChecked()) await dryRun.uncheck();
  await page.getByRole('button', { name: 'Start upload' }).click();
  await expect(page.getByRole('button', { name: 'Next batch' })).toBeVisible({ timeout: 120_000 });
  const completedAt = performance.now();

  expect(firstMediaRequestAt, 'first media request').toBeDefined();
  expect(lastMediaHeadAt, 'last media HEAD response').toBeDefined();
  expect(uploadCompleteAt, 'UploadComplete.json response').toBeDefined();
  expect(uploadPrefix, 'upload prefix').toBeDefined();

  const s3 = new S3Client({
    endpoint: MINIO_ORIGIN,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  });
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: COLLECTION_BUCKET, Prefix: `${uploadPrefix}/` }));
  const objects = listed.Contents ?? [];
  const metadata = objects.filter((item) => METADATA.has(item.Key?.split('/').at(-1) ?? ''));
  const media = objects.filter((item) => !METADATA.has(item.Key?.split('/').at(-1) ?? ''));
  expect(media).toHaveLength(362);
  expect(media.reduce((sum, item) => sum + (item.Size ?? 0), 0)).toBe(TOTAL_MEDIA_BYTES);
  expect(metadata).toHaveLength(5);
  // 360 single PUTs, 2x2 multipart parts, one listing page covering all 362
  // blobs, three spread-out HEAD samples for the digest contract, and 5 metadata PUTs.
  // The request profile is deterministic — any deviation (extra HEADs, retries,
  // a lost multipart path, doubled metadata) is a real regression, on any hardware.
  expect(requestCounts).toEqual({ mediaPut: 360, mediaHead: 3, mediaList: 1, multipartPart: 4, metadataPut: 5 });

  const clocks = {
    preprocessMs: Math.round(inspectedAt - folderAcceptedAt),
    payloadMs: Math.round(lastMediaHeadAt! - firstMediaRequestAt!),
    publishMs: Math.round(uploadCompleteAt! - firstMediaRequestAt!),
    endToEndMs: Math.round(completedAt - folderAcceptedAt),
  };
  await mkdir(path.dirname(resultFile), { recursive: true });
  await writeFile(resultFile, JSON.stringify({ runIndex, clocks, requestCounts }, null, 2) + '\n');
});
