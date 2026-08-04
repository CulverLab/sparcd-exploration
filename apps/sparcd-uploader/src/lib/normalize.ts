// Safe normalization for uploader identity and bundle object keys. Pure and
// synchronous — the upload sequence turns these into S3 keys, so the rules
// (allowed alphabet, no traversal, deterministic collision suffixes) live in
// one place that both the inspect-step validation and later phases consume.

/** uploaderUser → safe slug: lowercase ASCII letters, digits, `_`, `-`. */
export function sanitizeUploaderUser(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-') // any run of disallowed chars → single hyphen
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, ''); // no leading/trailing separators
}

export type NameResult = { ok: true; name: string } | { ok: false; reason: string };

/**
 * Normalize a bundle-relative path into a safe object-name stem: Unicode NFC,
 * control characters stripped, separators collapsed to `/`, leading slashes
 * removed, and `.` / `..` segments rejected outright.
 */
export function sanitizeRelPath(relPath: string): NameResult {
  const nfc = relPath.normalize('NFC');
  // eslint-disable-next-line no-control-regex
  const noCtrl = nfc.replace(new RegExp("[\\u0000-\\u001f\\u007f]", "g"), "");
  const collapsed = noCtrl.replace(/[\\/]+/g, '/').replace(/^\/+/, '');
  const segments = collapsed.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return { ok: false, reason: 'Empty name after normalization' };
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return { ok: false, reason: 'Path traversal segment' };
  }
  return { ok: true, name: segments.join('/') };
}

/** Deterministic 6-hex suffix derived from a seed (e.g. a content hash). */
export function shortSuffix(seed: string): string {
  // FNV-1a/32 — sync, dependency-free, and stable across runs. Only used to
  // disambiguate colliding object names, not for integrity.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Sanitized-name occurrence counts across a batch — the basis for collision
 * detection. Depends only on names (relPath/fileName), never on file content,
 * so it can be computed the instant a folder is scanned, before any file has
 * been hashed.
 */
export function nameCounts(items: { name: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it.name, (counts.get(it.name) ?? 0) + 1);
  return counts;
}

/**
 * Resolve one item's final object name against precomputed counts, appending
 * a short seed-derived suffix before the extension only if its name collides
 * with another item in the batch. Deterministic given the same inputs, so two
 * runs of the same batch produce identical keys.
 */
export function resolveOneName(name: string, seed: string, counts: Map<string, number>): string {
  if ((counts.get(name) ?? 0) <= 1) return name;
  const dot = name.lastIndexOf('.');
  const suffix = `-${shortSuffix(seed)}`;
  return dot > 0 ? name.slice(0, dot) + suffix + name.slice(dot) : name + suffix;
}

/**
 * Resolve colliding sanitized names by appending a short, seed-derived suffix
 * before the extension. Deterministic given the same inputs, so two runs of the
 * same batch produce identical keys.
 */
export function resolveCollisions(
  items: { id: string; name: string; seed: string }[],
): Map<string, string> {
  const counts = nameCounts(items);
  const out = new Map<string, string>();
  for (const it of items) out.set(it.id, resolveOneName(it.name, it.seed, counts));
  return out;
}
