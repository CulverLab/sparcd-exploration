// What a run takes away with it when it stops.
//
// Only the objects the harness wrote itself, each one recorded as it was
// written. The prefixes it seeds into are shared with whatever else lives in
// those buckets, so listing a prefix and deleting everything it returns would
// carry other people's objects off too.
//
// What the specs create through the proxy — people, keys, member lists, audit
// entries — the proxy writes under its own credentials, and their keys never
// reach the harness. Those stay behind. Emptying the buckets is the operator's
// way to reset them, and the same reset an external proxy's records need.

// The proxy keeps every person and key it knows under here. An external proxy
// owns those records, so a run that did not start the proxy leaves them alone
// even if it wrote one itself — including the administrator it signed in as.
export const ACCESS_PREFIX = 'Settings/access/';

export async function deleteObject(root, bucket, key) {
  const res = await root.send(root.url(bucket, key), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`delete ${bucket}/${key} → ${res.status}`);
}

/**
 * @param root     the upstream, signing as the run's own credentials.
 * @param written  `{ bucket, key }` for every object this run put there.
 */
export async function removeWritten(root, written, { startProxy }) {
  for (const { bucket, key } of written) {
    if (!startProxy && key.startsWith(ACCESS_PREFIX)) continue;
    await deleteObject(root, bucket, key);
  }
}
