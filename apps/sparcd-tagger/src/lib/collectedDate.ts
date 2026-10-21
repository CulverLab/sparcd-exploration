// PR #500 writes a delimited "collected YYYY-MM-DD" comment segment.
// Also accept the MM-DD-YYYY format documented by older Uploader guidance.
export function extractCollectedDate(description: unknown): string | null {
  // UploadMeta.json from older/foreign writers is not runtime-schema validated.
  if (typeof description !== 'string') return null;
  const match = description.match(/(?:^|\s+-\s+)collected\s+(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})(?=\s+-\s+|\s*$)/i);
  if (!match) return null;
  const raw = match[1];
  const value = /^\d{4}-/.test(raw) ? raw : `${raw.slice(6)}-${raw.slice(0, 2)}-${raw.slice(3, 5)}`;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  // Date.parse accepts overflow days (February 30 becomes March 1).
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}
