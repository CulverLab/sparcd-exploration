import type { S3Config } from '@sparcd/types';

export type WhoAmIResult =
  | { kind: 'resolved'; id: string; name: string }
  | { kind: 'unsupported' };

export class WhoAmIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WhoAmIError';
  }
}

const encoder = new TextEncoder();
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: BufferSource): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', value));
}

async function hmac(key: BufferSource, value: string): Promise<ArrayBuffer> {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', imported, encoder.encode(value));
}

function amzDate(date: Date): { timestamp: string; day: string } {
  const timestamp = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { timestamp, day: timestamp.slice(0, 8) };
}

async function signedHeaders(url: URL, config: S3Config, date = new Date()): Promise<Record<string, string>> {
  const { timestamp, day } = amzDate(date);
  const canonicalHeaders = `host:${url.host}\nx-amz-content-sha256:${EMPTY_SHA256}\nx-amz-date:${timestamp}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'GET',
    '/-/whoami',
    '',
    canonicalHeaders,
    signedHeaders,
    EMPTY_SHA256,
  ].join('\n');
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${timestamp}\n${scope}\n${await sha256(encoder.encode(canonicalRequest))}`;
  const dateKey = await hmac(encoder.encode(`AWS4${config.secretKey}`), day);
  const regionKey = await hmac(dateKey, config.region);
  const serviceKey = await hmac(regionKey, 's3');
  const signingKey = await hmac(serviceKey, 'aws4_request');
  const signature = hex(await crypto.subtle.sign(
    'HMAC',
    await crypto.subtle.importKey('raw', signingKey, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']),
    encoder.encode(stringToSign),
  ));
  return {
    'x-amz-date': timestamp,
    'x-amz-content-sha256': EMPTY_SHA256,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

function unsupportedResponse(status: number, body: string): boolean {
  // Failure statuses take precedence over any misleading route-absence body.
  if (status === 401 || status === 403 || status === 408 || status === 429 || status >= 500) return false;
  // Route absence must be established by a protocol-specific response, never
  // by an HTTP status alone. The access proxy uses a structured API error;
  // S3-compatible endpoints use their XML error code.
  try {
    const json = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
    if (
      json.error?.code === 'not_found' &&
      typeof json.error.message === 'string' &&
      /no such endpoint/i.test(json.error.message)
    ) return true;
  } catch {
    // Check the S3 XML response below.
  }
  // MinIO parses /-/whoami as bucket "-" and answers 400 InvalidBucketName.
  const code = body.match(/<Code>\s*(NoSuchKey|NotFound|NoSuchBucket|InvalidBucketName)\s*<\/Code>/i)?.[1];
  return !!code && status >= 400;
}

function messageFromError(status: number, body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { code?: unknown; message?: unknown } };
    if (typeof json.error?.message === 'string' && json.error.message.trim()) {
      return `The account name could not be loaded (${String(json.error.code ?? status)}): ${json.error.message}`;
    }
  } catch {
    // S3-compatible errors use XML; extract only their stable code/message.
  }
  const code = body.match(/<Code>\s*([^<]+)\s*<\/Code>/i)?.[1];
  const xmlMessage = body.match(/<Message>\s*([^<]+)\s*<\/Message>/i)?.[1];
  if (code) {
    return `The account name could not be loaded (${code}${xmlMessage ? `: ${xmlMessage}` : ''}). Check the connection and retry.`;
  }
  return `The account name could not be loaded (HTTP ${status}). Check the connection and retry.`;
}

/** Read the access-service display name using the connected S3 credentials. */
export async function fetchWhoAmI(config: S3Config, timeoutMs = 10_000): Promise<WhoAmIResult> {
  let url: URL;
  try {
    const endpoint = /^https?:\/\//i.test(config.endpoint)
      ? config.endpoint
      : `${config.secure === false ? 'http' : 'https'}://${config.endpoint}`;
    url = new URL('/-/whoami', endpoint);
  } catch {
    throw new WhoAmIError('The configured endpoint is invalid. Check the connection settings and retry.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = await signedHeaders(url, config);
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      credentials: 'omit',
    });
    const body = await response.text();
    if (!response.ok) {
      if (unsupportedResponse(response.status, body)) return { kind: 'unsupported' };
      throw new WhoAmIError(messageFromError(response.status, body));
    }

    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      throw new WhoAmIError('The account-name service returned an invalid response. Retry, or enter a custom identity.');
    }
    if (
      !value || typeof value !== 'object' ||
      typeof (value as { id?: unknown }).id !== 'string' || !(value as { id: string }).id.trim() ||
      typeof (value as { name?: unknown }).name !== 'string' || !(value as { name: string }).name.trim()
    ) {
      throw new WhoAmIError('The account-name service returned an incomplete response. Retry, or enter a custom identity.');
    }
    return {
      kind: 'resolved',
      id: (value as { id: string }).id,
      name: (value as { name: string }).name,
    };
  } catch (error) {
    if (error instanceof WhoAmIError) throw error;
    if (controller.signal.aborted) {
      throw new WhoAmIError('Loading the account name timed out. Check the connection and retry.');
    }
    throw new WhoAmIError('The account name could not be reached. Check the connection and retry.');
  } finally {
    clearTimeout(timeout);
  }
}
