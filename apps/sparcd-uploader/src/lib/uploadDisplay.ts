// Display helpers for published-upload metadata. Pure string formatting over the
// already-parsed UploadMeta.json, kept here so it's unit-testable. `uploadDate`
// is stored as local-time integer fields (consistent with the prefix stamp), so
// render them directly — never via a JS Date, which would re-interpret the zone.

import { formatDateTime24, type UploadDate, type UploadMetaJson } from '@sparcd/camtrap';

const p2 = (n: number) => String(n).padStart(2, '0');

// These render UploadMeta.json, which is a plain JSON.parse cast (no runtime
// schema) and can come from older uploads, the Java app, or foreign tools. Guard
// against shape drift so one malformed metadata file can't crash the whole list.

/** `YYYY-MM-DD at HH:MM` from the stored local-time fields, or a fallback. */
export function formatUploadDate(d: UploadDate | undefined | null): string {
  const date = d?.date;
  const time = d?.time;
  if (!date || !time) return 'unknown date';
  return `${date.year}-${p2(date.month)}-${p2(date.day)} at ${p2(time.hour)}:${p2(time.minute)}`;
}

/** `<uploader> on <date>` — mirrors the Java entry header (lblHeader). */
export function formatUploadHeader(meta: UploadMetaJson): string {
  return `${meta.uploadUser || '(unknown uploader)'} on ${formatUploadDate(meta.uploadDate)}`;
}

/** The timestamp shown for a History batch, kept beside the other display paths. */
export function formatHistoryBatchStart(startedAt: Date | string, timeZone?: string): string {
  return formatDateTime24(startedAt, timeZone);
}

/** Verified existing files are complete, but contributed no new transfer. */
export function summarizeUploadFiles(files: readonly { state: string }[]): {
  uploaded: number; verified: number; complete: number; failed: number;
} {
  let uploaded = 0, verified = 0, failed = 0;
  for (const file of files) {
    if (file.state === 'done') uploaded++;
    else if (file.state === 'skipped') verified++;
    else if (file.state === 'failed') failed++;
  }
  return { uploaded, verified, complete: uploaded + verified, failed };
}

export function formatTransferBreakdown(uploaded: number, verified: number): string {
  return `${uploaded} uploaded this attempt; ${verified} already stored and verified.`;
}
