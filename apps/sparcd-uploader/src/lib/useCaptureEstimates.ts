// The display side of the capture-time rule. `estimateCaptureTimes` is the same
// pure function the bundle build runs, so what Inspect and Assign show is what
// media.csv will carry: EXIF, else a hand/spread override, else the estimate.

import { useMemo } from 'react';
import type { TimestampSource } from '@sparcd/camtrap';
import { useStore, type FileEntry } from '../store';
import { estimateCaptureTimes, type CaptureEstimate } from './estimateCaptureTime';
import { formatNaive, type NaiveDateTime } from './exifTime';

export function useCaptureEstimates(): Map<string, CaptureEstimate> {
  const files = useStore((s) => s.files);
  const uploadTimeZone = useStore((s) => s.uploadTimeZone);
  return useMemo(() => estimateCaptureTimes(files, uploadTimeZone), [files, uploadTimeZone]);
}

/** The time this file will be published with, and where it came from. `source`
 *  is undefined only for a camera-written time. `naive` is undefined only while
 *  a file is still queued or processing — the estimate map covers ready files. */
export function effectiveTime(
  f: FileEntry,
  estimates: Map<string, CaptureEstimate>,
): { naive?: NaiveDateTime; source?: TimestampSource } {
  if (f.exifTimestampSource === 'exif-modify' && f.manualNaive)
    return { naive: f.manualNaive, source: f.manualSource ?? 'manual' };
  if (f.exifNaive) return { naive: f.exifNaive, source: f.exifTimestampSource };
  if (f.manualNaive) return { naive: f.manualNaive, source: f.manualSource ?? 'manual' };
  const estimate = estimates.get(f.id);
  return { naive: estimate?.naive, source: estimate?.method };
}

const TAGS: Record<TimestampSource, string> = {
  interpolated: 'EST.',
  offset: 'EST.',
  'file-modified': 'EST.',
  'exif-modify': 'MODIFIED',
  manual: 'MANUAL',
  spread: 'SPREAD',
};

export const sourceTag = (source: TimestampSource): string => TAGS[source];

const baseName = (relPath: string): string => relPath.split('/').pop() ?? relPath;

const shortNaive = (n: NaiveDateTime): string => formatNaive(n).replace('T', ' ');

/** One line saying how this file's time was arrived at. A sequence spread's
 * start lives on the file itself, rather than being re-derived from the batch,
 * so two folders spread independently each retain their own provenance. */
export function methodLine(
  f: FileEntry,
  estimate: CaptureEstimate | undefined,
  timeZone: string,
): string {
  if (f.exifTimestampSource === 'exif-modify')
    return f.manualNaive ? 'overrides EXIF ModifyDate' : 'EXIF ModifyDate — review or override';
  if (f.exifNaive) return 'camera time';
  if (f.manualNaive) {
    if (f.manualSource === 'spread') {
      if (f.manualSpreadMethod === 'sequence')
        return f.manualSpreadStart
          ? `spread from ${shortNaive(f.manualSpreadStart)}`
          : 'spread from sequence (start unavailable)';
      if (f.manualSpreadMethod === 'file-modified')
        return `spread from file modified times (${f.manualSpreadTimeZone ?? 'timezone unavailable'})`;
      return 'spread (provenance unavailable)';
    }
    return 'set by hand';
  }
  if (!estimate) return '';
  if (estimate.method === 'interpolated')
    return `between ${baseName(estimate.before!)} and ${baseName(estimate.after!)}`;
  if (estimate.method === 'offset')
    return estimate.before
      ? `${estimate.offsetMinutes} min after ${baseName(estimate.before)} (last file)`
      : `${estimate.offsetMinutes} min before ${baseName(estimate.after!)} (first file)`;
  return `file modified time (${timeZone})`;
}
