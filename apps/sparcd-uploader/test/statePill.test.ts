import { describe, expect, it } from 'vitest';
import { STATE_PILL_CONFIG, type UploadState } from '../src/components/StatePill';
import { uploadStateOf } from '../src/lib/uploadState';
import type { UploadPhase, UploadSnapshot } from '../src/lib/upload';

const STATES: UploadState[] = [
  'ready',
  'uploading',
  'publishing',
  'complete',
  'failed',
  'dry-run',
];

describe('uploader state-pill descriptions', () => {
  it('defines meaningful labels, glyphs, and explanations for every state', () => {
    expect(Object.keys(STATE_PILL_CONFIG).sort()).toEqual([...STATES].sort());
    for (const state of STATES) {
      expect(STATE_PILL_CONFIG[state].label.trim()).not.toBe('');
      expect(STATE_PILL_CONFIG[state].glyph.trim()).not.toBe('');
      expect(STATE_PILL_CONFIG[state].description.trim()).not.toBe('');
    }
  });

  it.each([
    ['ready', 'Ready to start an upload; no upload is currently in progress'],
    ['uploading', 'Upload in progress'],
    ['publishing', 'Publishing upload metadata'],
    ['complete', 'Upload complete'],
    ['failed', 'Upload failed'],
    ['dry-run', 'Dry run — nothing is written to S3'],
  ] satisfies [UploadState, string][])('%s explains its exact meaning', (state, description) => {
    expect(STATE_PILL_CONFIG[state].description).toBe(description);
  });
});

describe('live upload phase to title-bar state', () => {
  const snapshot = (phase: UploadPhase, dryRun = false): UploadSnapshot => ({
    version: 1,
    sessionId: 'session',
    phase,
    dryRun,
    files: [],
    uploadedBytes: 0,
    skippedBytes: 0,
    previewsWritten: 0,
    previewsSkipped: 0,
    totalBytes: 0,
    log: [],
    bucket: 'bucket',
    collectionUuid: 'collection',
  });

  it('maps an absent snapshot to ready', () => {
    expect(uploadStateOf(null)).toBe('ready');
  });

  it.each([
    ['idle', 'ready', 'ready'],
    ['preparing', 'uploading', 'dry-run'],
    ['blobs', 'uploading', 'dry-run'],
    ['metadata', 'publishing', 'dry-run'],
    ['partial', 'failed', 'failed'],
    ['done', 'complete', 'dry-run'],
    ['error', 'failed', 'failed'],
  ] satisfies [UploadPhase, UploadState, UploadState][])(
    'maps %s to %s for a real upload and %s for a dry run',
    (phase, realState, dryRunState) => {
      expect(uploadStateOf(snapshot(phase))).toBe(realState);
      expect(uploadStateOf(snapshot(phase, true))).toBe(dryRunState);
    },
  );
});
