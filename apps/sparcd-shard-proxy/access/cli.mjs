#!/usr/bin/env node
// Bootstrap. The API's admin routes need an admin to call them, so the first
// one is written here instead — once, refusing as soon as any admin exists.

import { configFromEnv } from './server.mjs';
import { makeStore } from './store.mjs';
import { makeUpstream } from './upstream.mjs';
import {
  loadMasterKey, newAccessKeyId, newPersonId, newSecretKey, wrapSecret,
} from './keys.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) out[arg.slice(2)] = argv[i + 1];
  }
  return out;
}

export async function init({ name, email, config }) {
  const upstream = makeUpstream({
    endpoint: config.upstream,
    region: config.region,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  });
  const store = makeStore({ upstream, namespace: config.namespace, allow: config.allow });
  await store.reload();

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

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command !== 'init' || !args.name || !args.email) {
    process.stderr.write('usage: node access/cli.mjs init --name "..." --email ...\n');
    process.exit(2);
  }
  const out = await init({ name: args.name, email: args.email, config: configFromEnv() });
  process.stdout.write(
    `admin ${out.name} <${out.email}>\n`
    + `  endpoint   ${out.endpoint}\n`
    + `  accessKey  ${out.accessKey}\n`
    + `  secretKey  ${out.secretKey}\n`
    + 'This secret is shown once and is not recoverable.\n',
  );
}
