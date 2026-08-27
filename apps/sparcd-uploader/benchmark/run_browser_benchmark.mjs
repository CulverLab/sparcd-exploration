#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BUCKET = 'sparcd-uploader-benchmark';
const DIRECT_ENDPOINT = 'https://js2.jetstream-cloud.org:8001';
const MEDIA_RE = /\.(?:jpe?g|mp4)$/i;
const METADATA_FILES = new Set([
  'deployments.csv',
  'media.csv',
  'observations.csv',
  'UploadMeta.json',
  'UploadComplete.json',
]);

export function classifyS3Request(rawUrl, method, bucket = BUCKET) {
  const url = new URL(rawUrl);
  if (url.pathname === '/') return 'service-root';
  const key = decodeURIComponent(url.pathname).replace(new RegExp(`^/${bucket}/?`), '');
  if (url.searchParams.has('uploads')) return 'multipart-create';
  if (url.searchParams.has('partNumber')) return 'multipart-part';
  if (url.searchParams.has('uploadId') && method === 'POST') return 'multipart-complete';
  if (url.searchParams.has('uploadId') && method === 'DELETE') return 'multipart-abort';
  const name = key.slice(key.lastIndexOf('/') + 1);
  if (MEDIA_RE.test(name)) return method === 'HEAD' ? 'media-head' : method === 'PUT' ? 'media-put' : 'media-read';
  if (METADATA_FILES.has(name)) return method === 'PUT' ? 'metadata-put' : 'metadata-read';
  if (key === 'Settings/locations.json') return 'settings';
  if (key.endsWith('/collection.json')) return 'collection-marker';
  if (url.searchParams.get('list-type') === '2') return 'list-objects';
  return 'other-s3';
}

function safeBrowserError(text) {
  return String(text).replace(/https?:\/\/[^\s'\"]+/g, '<URL>').slice(0, 1000);
}

export function summarizeProtocols(requests) {
  const summary = {};
  for (const request of requests) {
    const protocol = request.protocol || 'unknown';
    summary[protocol] = (summary[protocol] || 0) + 1;
  }
  return summary;
}

class CDP {
  constructor(webSocketUrl) {
    this.socket = new WebSocket(webSocketUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.onopen = resolve;
      this.socket.onerror = reject;
    });
    this.socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result);
        return;
      }
      for (const handler of this.handlers.get(message.method) || []) {
        Promise.resolve(handler(message.params)).catch((error) => {
          this.eventError ||= error;
        });
      }
    };
  }

  on(method, handler) {
    const handlers = this.handlers.get(method) || [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  send(method, params = {}) {
    if (this.eventError) return Promise.reject(this.eventError);
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: CDP command timed out`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, method, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'browser evaluation failed');
    return result.result.value;
  }

  async waitFor(expression, timeoutMs = 600_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const result = await this.evaluate(expression);
      if (result) return result;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`browser wait timed out after ${timeoutMs}ms`);
  }

  close() {
    this.socket.close();
  }
}

function parseArgs() {
  const args = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    args[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];
  }
  for (const required of ['dataset-root', 'dataset', 'results', 'endpoint', 'app-url', 'path-label']) {
    if (!args[required]) throw new Error(`missing --${required}`);
  }
  return args;
}

function chromeProcesses(profile) {
  let rssKib = 0;
  let cpuTicks = 0;
  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = fs.readFileSync(`/proc/${entry}/cmdline`, 'utf8');
      if (!cmdline.includes(profile)) continue;
      const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
      rssKib += Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] || 0);
      const stat = fs.readFileSync(`/proc/${entry}/stat`, 'utf8').trim().split(' ');
      cpuTicks += Number(stat[13]) + Number(stat[14]);
    } catch {
      // Process exited during sampling.
    }
  }
  return { rssKib, cpuTicks };
}

async function waitUntil(predicate, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`event wait timed out after ${timeoutMs}ms`);
}

async function waitForJson(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Browser not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`timeout waiting for ${url}`);
}

function runAws(args, env) {
  const aws = process.env.AWS_BIN || path.join(os.homedir(), '.local/bin/aws');
  const result = spawnSync(aws, args, { env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`AWS verification command failed: ${result.stderr}`);
  return result.stdout;
}

function prefixListArgs(prefix) {
  return [
    's3api',
    'list-objects-v2',
    '--bucket',
    BUCKET,
    '--prefix',
    `${prefix}/`,
    '--endpoint-url',
    DIRECT_ENDPOINT,
    '--output',
    'json',
  ];
}

function cleanupPrefix(prefix, env) {
  const listArgs = prefixListArgs(prefix);
  runAws(
    [
      's3',
      'rm',
      `s3://${BUCKET}/${prefix}/`,
      '--recursive',
      '--endpoint-url',
      DIRECT_ENDPOINT,
      '--only-show-errors',
    ],
    env,
  );
  const remaining = JSON.parse(runAws(listArgs, env)).Contents || [];
  if (remaining.length) throw new Error(`browser prefix cleanup failed: ${remaining.length} objects remain`);
}

function verifyAndCleanup(prefix, sourceFiles, sourceBytes, env) {
  const listArgs = prefixListArgs(prefix);
  const payload = JSON.parse(runAws(listArgs, env));
  const objects = payload.Contents || [];
  const media = objects.filter((item) => MEDIA_RE.test(item.Key));
  const metadata = objects.filter((item) => METADATA_FILES.has(item.Key.slice(item.Key.lastIndexOf('/') + 1)));
  const verification = {
    objects: objects.length,
    bytes: objects.reduce((sum, item) => sum + item.Size, 0),
    mediaObjects: media.length,
    mediaBytes: media.reduce((sum, item) => sum + item.Size, 0),
    metadataObjects: metadata.length,
  };
  if (
    verification.mediaObjects !== sourceFiles ||
    verification.mediaBytes !== sourceBytes ||
    verification.metadataObjects !== 5
  ) {
    throw new Error(`remote verification mismatch: ${JSON.stringify(verification)}`);
  }
  cleanupPrefix(prefix, env);
  return { ...verification, cleanupVerified: true };
}

function performanceObject(metrics) {
  return Object.fromEntries(metrics.metrics.map((metric) => [metric.name, metric.value]));
}

async function main() {
  const args = parseArgs();
  const accessKey = process.env.AWS_ACCESS_KEY_ID;
  const secretKey = process.env.AWS_SECRET_ACCESS_KEY;
  if (!accessKey || !secretKey) throw new Error('AWS credentials missing');
  const datasetRoot = path.resolve(args['dataset-root']);
  const datasetDir = path.join(datasetRoot, 'datasets', args.dataset);
  const manifest = (await fsp.readFile(path.join(datasetRoot, 'manifests', `${args.dataset}.jsonl`), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  const sourceBytes = manifest.reduce((sum, item) => sum + item.bytes, 0);
  const sourceFiles = manifest.length;
  if (!sourceFiles || !sourceBytes) throw new Error('dataset manifest is empty');

  const results = path.resolve(args.results);
  await fsp.mkdir(results, { recursive: true });
  const stagesPath = path.join(results, 'stages.jsonl');
  const stage = (name, details = {}) =>
    fsp.appendFile(stagesPath, JSON.stringify({ utc: new Date().toISOString(), stage: name, ...details }) + '\n');
  await stage('started');
  const profile = await fsp.mkdtemp(path.join(os.homedir(), '.cache', 'sparcd-browser-benchmark-'));
  const chromeLog = fs.openSync(path.join(results, 'chrome.log'), 'w', 0o600);
  const port = 9224;
  const chromeArgs = [
    '--headless=new',
    '--disable-extensions',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ];
  if (args['disable-quic'] === 'true') chromeArgs.splice(1, 0, '--disable-quic');
  const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', chromeArgs, {
    detached: true,
    stdio: ['ignore', 'ignore', chromeLog],
  });
  const observedPrefixes = new Set();
  let cdp;
  let sampler;
  let peakRssKib = 0;
  let startCpuTicks = 0;
  let endCpuTicks = 0;
  let completedPrefix;
  const requests = new Map();
  const sanitizedRequests = [];
  const errors = [];
  const uploadEvents = {};
  const wall = {};
  const awsConfig = path.join(results, 'aws-verification.ini');
  await fsp.writeFile(
    awsConfig,
    '[default]\nregion = us-east-1\ns3 =\n    addressing_style = path\n',
    { mode: 0o600 },
  );
  const awsEnv = {
    ...process.env,
    AWS_CONFIG_FILE: awsConfig,
    AWS_PAGER: '',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
    AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required',
  };

  try {
    const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const pages = await waitForJson(`http://127.0.0.1:${port}/json/list`);
    const page = pages.find((item) => item.type === 'page');
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await stage('browser-connected', { browser: version.Browser });
    await Promise.all([
      cdp.send('Page.enable'),
      cdp.send('Runtime.enable'),
      cdp.send('Network.enable'),
      cdp.send('Performance.enable'),
      cdp.send('Log.enable'),
      cdp.send('DOM.enable'),
      cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }),
    ]);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: "Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });",
    });

    const endpointOrigin = new URL(args.endpoint).origin;
    const appOrigin = new URL(args['app-url']).origin;
    if (!/^https?:\/\/localhost(:\d+)?$/.test(appOrigin)) {
      throw new Error(`--app-url must be a localhost origin (got ${appOrigin}); refusing to inject credentials into an untrusted page`);
    }
    const bucketXml = `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>benchmark</ID><DisplayName>benchmark</DisplayName></Owner><Buckets><Bucket><Name>${BUCKET}</Name><CreationDate>2026-07-25T00:00:00.000Z</CreationDate></Bucket></Buckets></ListAllMyBucketsResult>`;
    const uploadPrefix = 'Collections/uploader-benchmark/Uploads/';
    const deploymentsXml = `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${BUCKET}</Name><Prefix>${uploadPrefix}</Prefix><Delimiter>/</Delimiter><IsTruncated>false</IsTruncated><CommonPrefixes><Prefix>${uploadPrefix}bootstrap/</Prefix></CommonPrefixes></ListBucketResult>`;
    const mockDeployments = args['mock-deployments'] === 'true';
    const commonCors = [
      { name: 'Access-Control-Allow-Origin', value: appOrigin },
      { name: 'Access-Control-Allow-Methods', value: 'GET,HEAD,PUT,POST,DELETE' },
      {
        name: 'Access-Control-Allow-Headers',
        value: 'authorization,content-type,x-amz-content-sha256,x-amz-date,x-amz-user-agent,amz-sdk-invocation-id,amz-sdk-request,x-amz-checksum-mode',
      },
      { name: 'Access-Control-Max-Age', value: '600' },
    ];
    cdp.on('Fetch.requestPaused', async (event) => {
      const url = new URL(event.request.url);
      const serviceRoot = url.origin === endpointOrigin && url.pathname === '/' && ['GET', 'OPTIONS'].includes(event.request.method);
      const deploymentsList =
        mockDeployments &&
        url.origin === endpointOrigin &&
        url.pathname === `/${BUCKET}/` &&
        event.request.method === 'GET' &&
        url.searchParams.get('list-type') === '2' &&
        url.searchParams.get('prefix') === uploadPrefix;
      if (serviceRoot || deploymentsList) {
        const body = deploymentsList ? deploymentsXml : event.request.method === 'GET' ? bucketXml : '';
        await cdp.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: 200,
          responseHeaders: [...commonCors, { name: 'Content-Type', value: 'application/xml' }],
          body: Buffer.from(body).toString('base64'),
        });
      } else {
        await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
      }
    });

    cdp.on('Runtime.exceptionThrown', (event) => errors.push({ type: 'runtime', text: event.exceptionDetails?.text || 'exception' }));
    cdp.on('Log.entryAdded', (event) => {
      if (event.entry.level === 'error') {
        const text = safeBrowserError(event.entry.text);
        errors.push({ type: 'log', text });
        if (event.entry.text.includes('blocked by CORS policy')) uploadEvents.corsFailure = text;
      }
    });
    cdp.on('Network.requestWillBeSent', (event) => {
      const url = new URL(event.request.url);
      if (url.origin !== endpointOrigin) return;
      const requestClass = classifyS3Request(event.request.url, event.request.method, BUCKET);
      const match = decodeURIComponent(url.pathname).match(
        new RegExp(`^/${BUCKET}/(Collections/uploader-benchmark/Uploads/[^/]+)`),
      );
      if (match && ['PUT', 'POST'].includes(event.request.method)) observedPrefixes.add(match[1]);
      const requestHeaderNames =
        event.request.method === 'OPTIONS'
          ? String(
              event.request.headers['Access-Control-Request-Headers'] ||
                event.request.headers['access-control-request-headers'] ||
                '',
            )
              .split(',')
              .map((name) => name.trim().toLowerCase())
              .filter(Boolean)
          : undefined;
      requests.set(event.requestId, {
        requestClass,
        method: event.request.method,
        requestHeaderNames,
        isCompletion: decodeURIComponent(url.pathname).endsWith('/UploadComplete.json') && event.request.method === 'PUT',
        started: event.timestamp,
        wallStarted: Date.now(),
      });
      if (
        event.request.method !== 'OPTIONS' &&
        ['media-put', 'multipart-create', 'multipart-part'].includes(requestClass) &&
        !uploadEvents.payloadStart
      )
        uploadEvents.payloadStart = Date.now();
    });
    cdp.on('Network.responseReceived', (event) => {
      const request = requests.get(event.requestId);
      if (!request) return;
      request.status = event.response.status;
      request.protocol = event.response.protocol;
    });
    cdp.on('Network.loadingFinished', (event) => {
      const request = requests.get(event.requestId);
      if (!request) return;
      request.finished = event.timestamp;
      request.wallFinished = Date.now();
      request.responseBytes = event.encodedDataLength;
      if (
        request.method !== 'OPTIONS' &&
        ['media-put', 'multipart-part', 'multipart-complete'].includes(request.requestClass)
      )
        uploadEvents.payloadEnd = Date.now();
      if (request.requestClass === 'metadata-put') uploadEvents.publishEnd = Date.now();
      if (request.isCompletion) uploadEvents.completionFinished = Date.now();
      sanitizedRequests.push({
        sequence: sanitizedRequests.length + 1,
        class: request.requestClass,
        method: request.method,
        status: request.status,
        protocol: request.protocol || 'unknown',
        durationMs: (request.finished - request.started) * 1000,
        responseBytes: request.responseBytes,
        ...(request.requestHeaderNames ? { requestHeaderNames: request.requestHeaderNames } : {}),
      });
    });
    cdp.on('Network.loadingFailed', (event) => {
      const request = requests.get(event.requestId);
      if (!request) return;
      sanitizedRequests.push({
        sequence: sanitizedRequests.length + 1,
        class: request.requestClass,
        method: request.method,
        failed: true,
        error: event.errorText,
      });
    });

    const firstSample = chromeProcesses(profile);
    startCpuTicks = firstSample.cpuTicks;
    peakRssKib = firstSample.rssKib;
    sampler = setInterval(() => {
      const sample = chromeProcesses(profile);
      peakRssKib = Math.max(peakRssKib, sample.rssKib);
      endCpuTicks = sample.cpuTicks;
    }, 250);

    await cdp.send('Page.navigate', { url: args['app-url'] });
    await cdp.waitFor("document.readyState === 'complete'");
    await cdp.waitFor("!!(document.querySelector('#endpoint') && document.querySelector('#accessKey') && document.querySelector('#secretKey'))");
    const connection = JSON.stringify({ endpoint: args.endpoint, accessKey, secretKey });
    await cdp.evaluate(`(() => {
      const values = ${connection};
      const set = (id, value) => {
        const input = document.getElementById(id);
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('endpoint', values.endpoint); set('accessKey', values.accessKey); set('secretKey', values.secretKey);
      return true;
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await cdp.evaluate("document.querySelector('form').requestSubmit(); true");
    await cdp.waitFor("document.querySelector('input[type=file]') !== null");
    const document = await cdp.send('DOM.getDocument', { depth: 1, pierce: true });
    const input = await cdp.send('DOM.querySelector', { nodeId: document.root.nodeId, selector: 'input[type=file]' });
    wall.folderAccepted = Date.now();
    const before = performanceObject(await cdp.send('Performance.getMetrics'));
    await cdp.send('DOM.setFileInputFiles', { files: [datasetDir], nodeId: input.nodeId });
    const preprocessing = await cdp.waitFor(`(() => {
      const line = [...document.querySelectorAll('p')].find((node) => node.textContent.includes(' files · '));
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Continue');
      if (!line || !button || line.textContent.includes('processing') || button.disabled) return null;
      return line.textContent.replace(/\\s+/g, ' ').trim();
    })()`, 1_200_000);
    wall.preprocessingDone = Date.now();
    await stage('preprocessing-complete', { elapsedMs: wall.preprocessingDone - wall.folderAccepted });
    await cdp.evaluate("[...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Continue').click(); true");
    await cdp.waitFor("document.body.innerText.includes('SPARCd Upload Benchmark') && document.body.innerText.includes('Select a deployment location')", 30_000);
    // ListBuckets is now cached and benchmark-scoped; stop pausing traffic before payload PUTs.
    await cdp.send('Fetch.disable');
    await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent.includes('Select a deployment location'));
      button.click(); return true;
    })()`);
    await cdp.waitFor("document.querySelector('[role=option]') !== null");
    await cdp.evaluate("document.querySelector('[role=option]').click(); true");
    await cdp.evaluate(`(() => {
      const heading = [...document.querySelectorAll('h2')].find((node) => node.textContent.trim() === 'Uploader');
      const input = heading.parentElement.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Benchmark Agent');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await cdp.waitFor(`(() => {
      const buttons = [...document.querySelectorAll('button')].filter((node) => node.textContent.trim() === 'Continue');
      return buttons.length && !buttons.at(-1).disabled;
    })()`);
    await cdp.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')].filter((node) => node.textContent.trim() === 'Continue');
      buttons.at(-1).click(); return true;
    })()`);
    await cdp.waitFor("[...document.querySelectorAll('button')].some((node) => node.textContent.trim() === 'Start dry run')");
    await cdp.evaluate(`(() => {
      const checkbox = document.querySelector('input[type=checkbox]'); checkbox.click();
      const range = document.querySelector('input[type=range]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, '8');
      range.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
    await cdp.waitFor("[...document.querySelectorAll('button')].some((node) => node.textContent.trim() === 'Start upload')");
    await stage('assignment-complete');
    wall.uploadStartClick = Date.now();
    await cdp.evaluate("[...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Start upload').click(); true");
    await stage('upload-started');
    await waitUntil(() => {
      if (uploadEvents.corsFailure) throw new Error(`browser CORS failure: ${uploadEvents.corsFailure}`);
      return uploadEvents.completionFinished;
    }, 180_000);
    wall.uploadDone = uploadEvents.completionFinished;
    await stage('upload-completion-matched');
    if (observedPrefixes.size !== 1) throw new Error(`expected one upload prefix, observed ${observedPrefixes.size}`);
    completedPrefix = [...observedPrefixes][0];
    const completion = {
      prefix: completedPrefix,
      text: `Published ${sourceFiles} files under Collections/uploader-benchmark/Uploads/<run>/.`,
    };
    observedPrefixes.add(completedPrefix);
    const after = performanceObject(await cdp.send('Performance.getMetrics'));
    await stage('performance-captured');
    clearInterval(sampler);
    sampler = undefined;
    const finalSample = chromeProcesses(profile);
    peakRssKib = Math.max(peakRssKib, finalSample.rssKib);
    endCpuTicks = finalSample.cpuTicks;
    await stage('remote-verification-started');
    const remote = verifyAndCleanup(completedPrefix, sourceFiles, sourceBytes, awsEnv);
    await stage('remote-verification-complete');
    observedPrefixes.delete(completedPrefix);

    const mediaRequests = sanitizedRequests.filter(
      (request) =>
        request.method !== 'OPTIONS' &&
        [
          'media-put',
          'media-head',
          'multipart-create',
          'multipart-part',
          'multipart-complete',
        ].includes(request.class),
    );
    const failedRequests = sanitizedRequests.filter((request) => request.failed || (request.status && request.status >= 400));
    const result = {
      schemaVersion: 1,
      path: args['path-label'],
      endpoint: args.endpoint,
      appUrl: args['app-url'],
      browser: version.Browser,
      diagnosticFlags: args['disable-quic'] === 'true' ? ['--disable-quic'] : [],
      discoveryMocks: ['ListBuckets', ...(mockDeployments ? ['ListCollectionDeployments'] : [])],
      sandboxDisabled: false,
      dataset: args.dataset,
      sourceFiles,
      sourceBytes,
      concurrency: 8,
      appSnapshot: { preprocessing, completion: completion.text },
      timingsMs: {
        preprocess: wall.preprocessingDone - wall.folderAccepted,
        payload: uploadEvents.payloadEnd - uploadEvents.payloadStart,
        publish: uploadEvents.publishEnd - uploadEvents.payloadStart,
        endToEnd: wall.uploadDone - wall.folderAccepted,
        uploadUi: wall.uploadDone - wall.uploadStartClick,
      },
      goodput: {
        payloadMiBPerSecond: sourceBytes / 1024 / 1024 / ((uploadEvents.payloadEnd - uploadEvents.payloadStart) / 1000),
        publishMiBPerSecond: sourceBytes / 1024 / 1024 / ((uploadEvents.publishEnd - uploadEvents.payloadStart) / 1000),
      },
      requests: sanitizedRequests,
      requestSummary: {
        total: sanitizedRequests.length,
        media: mediaRequests.length,
        failed: failedRequests.length,
        protocols: summarizeProtocols(sanitizedRequests),
        byClass: Object.groupBy(sanitizedRequests, (request) => request.class),
      },
      performance: {
        before,
        after,
        pageTaskDurationSeconds: after.TaskDuration - before.TaskDuration,
        pageScriptDurationSeconds: after.ScriptDuration - before.ScriptDuration,
        peakChromeTreeRssKib: peakRssKib,
        chromeTreeCpuSeconds: (endCpuTicks - startCpuTicks) / Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()),
      },
      browserErrors: errors,
      remoteVerification: remote,
      uploadPrefixClass: 'Collections/uploader-benchmark/Uploads/<run>/',
      cleanupVerified: true,
    };
    // Replace grouped request arrays with counts; URLs and headers were never retained.
    result.requestSummary.byClass = Object.fromEntries(
      Object.entries(result.requestSummary.byClass).map(([key, value]) => [key, value.length]),
    );
    await fsp.writeFile(path.join(results, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    await stage('result-written');
    console.log(JSON.stringify({ passed: !errors.length && !failedRequests.length, path: result.path, payloadMiBPerSecond: result.goodput.payloadMiBPerSecond, publishMiBPerSecond: result.goodput.publishMiBPerSecond, protocols: result.requestSummary.protocols, requests: result.requestSummary.total, cleanupVerified: true }));
    if (errors.length || failedRequests.length) process.exitCode = 1;
  } catch (error) {
    const message = String(error?.stack || error).replaceAll(accessKey, '<REDACTED_ACCESS_KEY>').replaceAll(secretKey, '<REDACTED_SECRET_KEY>');
    let browserState = null;
    try {
      browserState = await cdp?.evaluate("({ text: document.body.innerText.slice(0, 4000), title: document.title })");
    } catch {
      // Browser may already be unavailable.
    }
    await fsp.writeFile(
      path.join(results, 'failure.json'),
      JSON.stringify(
        {
          error: message,
          browserState,
          browserErrors: errors,
          requests: sanitizedRequests,
          protocols: summarizeProtocols(sanitizedRequests),
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
    throw error;
  } finally {
    if (sampler) clearInterval(sampler);
    for (const prefix of observedPrefixes) {
      try {
        cleanupPrefix(prefix, awsEnv);
      } catch {
        // Preserve primary failure; lifecycle/admin cleanup can use recorded prefix class.
      }
    }
    cdp?.close();
    try {
      process.kill(-chrome.pid, 'SIGTERM');
    } catch {
      // Already exited.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      process.kill(-chrome.pid, 'SIGKILL');
    } catch {
      // Already exited.
    }
    fs.closeSync(chromeLog);
    await fsp.rm(profile, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    const access = process.env.AWS_ACCESS_KEY_ID || '';
    const secret = process.env.AWS_SECRET_ACCESS_KEY || '';
    const message = String(error?.message || error)
      .replaceAll(access, '<REDACTED_ACCESS_KEY>')
      .replaceAll(secret, '<REDACTED_SECRET_KEY>');
    console.error(message);
    process.exitCode = 1;
  });
}
