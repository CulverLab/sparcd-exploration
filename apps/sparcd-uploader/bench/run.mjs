import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appDir = fileURLToPath(new URL('../', import.meta.url));
const benchDir = fileURLToPath(new URL('./', import.meta.url));
const resultsDir = path.join(benchDir, 'results');
const containerName = `sparcd-uploader-bench-${process.pid}`;
const minioOrigin = 'http://127.0.0.1:19000';
const collectionUuid = '11111111-1111-1111-1111-111111111111';
const collectionBucket = `sparcd-${collectionUuid}`;
let preview;
let containerStarted = false;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: appDir, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status}`);
}

// Plain node:http, not fetch: while the container boots, Docker's userland
// proxy accepts connections on the mapped port and immediately closes them,
// which undici's fetch mishandles (retry loop locally, silent exit 13 on
// GitHub runners). node:http surfaces it as a plain ECONNRESET we can retry.
async function waitFor(url, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const status = await new Promise((resolve) => {
      const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
      req.on('error', () => resolve(0));
    });
    if (status === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become ready`);
}

function stop() {
  if (preview && !preview.killed) preview.kill('SIGTERM');
  if (containerStarted) spawnSync('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
}

process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err);
  stop();
  process.exit(1);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stop();
    process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
  });
}

try {
  run(process.execPath, [path.join(benchDir, 'gen-fixtures.mjs')]);
  await rm(resultsDir, { recursive: true, force: true });
  await mkdir(resultsDir, { recursive: true });

  run('docker', [
    'run', '-d', '--rm', '--name', containerName, '-p', '19000:9000',
    '-e', 'MINIO_ROOT_USER=minioadmin',
    '-e', 'MINIO_ROOT_PASSWORD=minioadmin',
    '-e', 'MINIO_API_CORS_ALLOW_ORIGIN=http://localhost:5316',
    'docker.io/coollabsio/minio@sha256:69b55a1c1c5dc285ce04db96689f5b2102317fc77a50680a1874ca6efd1c87f9', 'server', '/data',
  ]);
  containerStarted = true;
  await waitFor(`${minioOrigin}/minio/health/ready`, 'MinIO');
  console.log('minio ready');

  const s3 = new S3Client({
    endpoint: minioOrigin,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'minioadmin', secretAccessKey: 'minioadmin' },
  });
  for (const bucket of ['sparcd-settings-bench', collectionBucket]) {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  const locations = [{
    nameProperty: 'Bear Canyon', idProperty: 'BEAR1', latProperty: 32.4,
    lngProperty: -110.7, elevationProperty: 1200,
  }];
  const collection = {
    nameProperty: 'Benchmark Collection',
    organizationProperty: 'SPARCd',
    contactInfoProperty: 'bench@example.org',
    descriptionProperty: 'Local performance benchmark',
  };
  await s3.send(new PutObjectCommand({
    Bucket: 'sparcd-settings-bench', Key: 'Settings/locations.json',
    Body: JSON.stringify(locations), ContentType: 'application/json',
  }));
  await s3.send(new PutObjectCommand({
    Bucket: collectionBucket, Key: `Collections/${collectionUuid}/collection.json`,
    Body: JSON.stringify(collection), ContentType: 'application/json',
  }));
  console.log('buckets seeded');

  run('pnpm', ['exec', 'vite', 'build'], {
    env: { ...process.env, VITE_SPARCD_S3_ENDPOINT: '' },
  });
  preview = spawn('pnpm', ['exec', 'vite', 'preview', '--port', '5316', '--strictPort'], {
    cwd: appDir,
    env: { ...process.env, VITE_SPARCD_S3_ENDPOINT: '' },
    stdio: 'inherit',
  });
  await waitFor('http://localhost:5316/sparcd-exploration/uploader/', 'Vite preview');

  for (let runIndex = 1; runIndex <= 3; runIndex++) {
    const resultFile = path.join(resultsDir, `run-${runIndex}.json`);
    run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.bench.config.ts'], {
      env: { ...process.env, BENCH_RUN_INDEX: String(runIndex), BENCH_RESULT_FILE: resultFile },
    });
  }

  const budgetFile = JSON.parse(await readFile(path.join(benchDir, 'budget.json'), 'utf8'));
  const results = await Promise.all([1, 2, 3].map(async (index) =>
    JSON.parse(await readFile(path.join(resultsDir, `run-${index}.json`), 'utf8'))));
  const clocks = Object.keys(budgetFile.backstopsMs);
  const mins = Object.fromEntries(clocks.map((clock) => [clock, Math.min(...results.map((r) => r.clocks[clock]))]));
  const failed = clocks.filter((clock) => mins[clock] > budgetFile.backstopsMs[clock]);
  const rows = clocks.map((clock) => [
    clock, ...results.map((result) => result.clocks[clock]), mins[clock],
    budgetFile.backstopsMs[clock], mins[clock] <= budgetFile.backstopsMs[clock] ? 'PASS' : 'FAIL',
  ]);
  const headings = ['Clock', 'Run 1', 'Run 2', 'Run 3', 'Min', 'Backstop', 'Gate'];
  const widths = headings.map((heading, index) => Math.max(heading.length, ...rows.map((row) => String(row[index]).length)));
  const line = (row) => row.map((cell, index) => String(cell).padEnd(widths[index])).join('  ');
  console.log(`\n${line(headings)}\n${line(widths.map((width) => '-'.repeat(width)))}\n${rows.map(line).join('\n')}\n`);

  await writeFile(path.join(resultsDir, 'summary.json'), JSON.stringify({
    mins,
    runs: results.map((result) => result.clocks),
    requestCounts: results[0].requestCounts,
  }, null, 2) + '\n');

  if (process.env.GITHUB_STEP_SUMMARY) {
    const markdown = [
      '## Uploader performance benchmark', '',
      `| ${headings.join(' | ')} |`,
      `| ${headings.map(() => '---').join(' | ')} |`,
      ...rows.map((row) => `| ${row.join(' | ')} |`), '',
    ].join('\n');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
  }
  if (failed.length) throw new Error(`performance backstop exceeded (this is a multi-x regression or a hang, not runner noise): ${failed.join(', ')}`);
} finally {
  stop();
}
