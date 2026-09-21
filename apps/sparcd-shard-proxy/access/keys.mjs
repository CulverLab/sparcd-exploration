// Credential material: the key pairs the proxy issues, the AES-GCM wrapping
// that lets it store the secret half, and the single-use invite tokens.

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { webcrypto } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** `SPK` + 17 base32 characters, per the contract. */
export function newAccessKeyId() {
  const bytes = randomBytes(17);
  let out = 'SPK';
  for (const b of bytes) out += BASE32[b % 32];
  return out;
}

/** 40 characters, the shape every S3 client expects a secret to have. */
export function newSecretKey() {
  return b64url(randomBytes(30));
}

export function loadMasterKey(base64) {
  const raw = Buffer.from(String(base64 ?? ''), 'base64');
  if (raw.length !== 32) throw new Error('ACCESS_MASTER_KEY must be 32 bytes, base64');
  return webcrypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** `v1.<iv b64url>.<ciphertext+tag b64url>` */
export async function wrapSecret(masterKey, secret) {
  const iv = randomBytes(12);
  const ct = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, masterKey, Buffer.from(secret, 'utf8'),
  );
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function unwrapSecret(masterKey, wrapped) {
  const [version, iv, ct] = String(wrapped ?? '').split('.');
  if (version !== 'v1' || !iv || !ct) throw new Error('unrecognised wrapped secret');
  const plain = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(iv, 'base64url') },
    masterKey,
    Buffer.from(ct, 'base64url'),
  );
  return Buffer.from(plain).toString('utf8');
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function newInvite(now = Date.now()) {
  const token = b64url(randomBytes(32));
  return {
    token,
    record: { tokenHash: hashToken(token), expiresAt: new Date(now + INVITE_TTL_MS).toISOString() },
  };
}

export function hashToken(token) {
  return createHash('sha256').update(String(token), 'utf8').digest('hex');
}

/** A token matches only an unexpired invite, and the compare does not leak. */
export function inviteMatches(invite, token, now = Date.now()) {
  if (!invite?.tokenHash) return false;
  if (Date.parse(invite.expiresAt) <= now) return false;
  const a = Buffer.from(invite.tokenHash, 'hex');
  const b = Buffer.from(hashToken(token), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function newPersonId() {
  return webcrypto.randomUUID();
}
