#!/usr/bin/env node
// Bootstrap and migration. The API's admin routes need an admin to call them,
// so the first one is written here instead — once, refusing as soon as any
// admin exists. `import` brings in someone's existing login.

import { configFromEnv } from './server.mjs';
import { makeStore } from './store.mjs';
import { makeUpstream } from './upstream.mjs';
import {
  loadMasterKey, newAccessKeyId, newPersonId, newSecretKey, wrapSecret,
} from './keys.mjs';

const FLAGS = new Set(['admin']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const flag = arg.slice(2);
    const next = argv[i + 1];
    out[flag] = FLAGS.has(flag) ? true : (next?.startsWith('--') ? undefined : next);
  }
  return out;
}

async function openStore(config) {
  const upstream = makeUpstream({
    endpoint: config.upstream,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
  const store = makeStore({ upstream, namespace: config.namespace, allow: config.allow });
  await store.reload();
  return store;
}

export async function init({ name, email, config }) {
  const store = await openStore(config);

  if (store.people().some((p) => p.admin)) {
    throw new Error('an admin already exists; use the API to add people');
  }

  const masterKey = await loadMasterKey(config.masterKey);
  const secretKey = newSecretKey();
  const accessKey = newAccessKeyId();
  const now = new Date().toISOString();
  const person = {
    schemaVersion: 1,
    id: newPersonId(),
    name,
    email,
    status: 'active',
    admin: true,
    keys: [{
      accessKeyId: accessKey,
      wrappedSecret: await wrapSecret(masterKey, secretKey),
      createdAt: now,
    }],
    createdBy: 'cli',
    createdAt: now,
    updatedAt: now,
  };
  await store.savePerson(person, 'new');
  return { endpoint: config.publicEndpoint ?? config.upstream, accessKey, secretKey, name, email };
}

// MinIO allows 3 to 20 characters. The Authorization header splits on `,`,
// `=` and `/`, so ids keep to characters that parse the same everywhere.
const ACCESS_KEY_ID = /^[A-Za-z0-9._@+-]{3,128}$/;
const MIN_SECRET = 8;

/** The first reason an import cannot go ahead, or null. */
export function importProblem({ name, email, accessKey, secret }, people) {
  if (!name || !email) return 'name and email are required';
  if (!ACCESS_KEY_ID.test(accessKey ?? '')) {
    return 'access key must be 3 to 128 letters, digits, or . _ @ + -';
  }
  if (String(secret ?? '').length < MIN_SECRET) {
    return `secret must be at least ${MIN_SECRET} characters`;
  }
  // Retired ids count: a person's history keeps naming the key.
  if (people.some((p) => (p.keys ?? []).some((k) => k.accessKeyId === accessKey))) {
    return 'that access key already belongs to someone';
  }
  const wanted = email.trim().toLowerCase();
  if (people.some((p) => String(p.email ?? '').trim().toLowerCase() === wanted)) {
    return 'that email already belongs to a person';
  }
  return null;
}

/** An existing key pair becomes an active person's key, so their login keeps working. */
export async function importLogin({ name, email, accessKey, secret, admin = false, config }) {
  const store = await openStore(config);
  const problem = importProblem({ name, email, accessKey, secret }, store.people());
  if (problem) throw new Error(problem);

  const masterKey = await loadMasterKey(config.masterKey);
  const now = new Date().toISOString();
  await store.savePerson({
    schemaVersion: 1,
    id: newPersonId(),
    name,
    email,
    status: 'active',
    admin: !!admin,
    keys: [{
      accessKeyId: accessKey,
      wrappedSecret: await wrapSecret(masterKey, secret),
      createdAt: now,
    }],
    createdBy: 'cli',
    createdAt: now,
    updatedAt: now,
  }, 'new');
  return { endpoint: config.publicEndpoint ?? config.upstream, accessKey, name, email, admin: !!admin };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const usage = {
    init: 'init --name "..." --email ...',
    import: 'import --name "..." --email ... --access-key ... [--secret ... | IMPORT_SECRET=...] [--admin]',
  };
  if (!usage[command] || !args.name || !args.email) {
    process.stderr.write(`usage: node access/cli.mjs ${usage[command] ?? `<${Object.keys(usage).join('|')}> ...`}\n`);
    process.exit(2);
  }
  if (command === 'import') {
    try {
      const out = await importLogin({
        name: args.name,
        email: args.email,
        accessKey: args['access-key'],
        secret: args.secret ?? process.env.IMPORT_SECRET,
        admin: args.admin,
        config: configFromEnv(),
      });
      process.stdout.write(
        `${out.admin ? 'admin' : 'person'} ${out.name} <${out.email}>\n`
        + `  endpoint   ${out.endpoint}\n`
        + `  accessKey  ${out.accessKey}\n`
        + 'They sign in with the access key and secret they already use.\n',
      );
    } catch (err) {
      process.stderr.write(`import: ${err.message}\n`);
      process.exit(1);
    }
  } else {
    const out = await init({ name: args.name, email: args.email, config: configFromEnv() });
    process.stdout.write(
      `admin ${out.name} <${out.email}>\n`
      + `  endpoint   ${out.endpoint}\n`
      + `  accessKey  ${out.accessKey}\n`
      + `  secretKey  ${out.secretKey}\n`
      + 'This secret is shown once and is not recoverable.\n',
    );
  }
}
