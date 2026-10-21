import { describe, expect, it } from 'vitest';
import type { DraftObservation, DraftRecord } from '../src/lib/db';
import { buildDiscardSummaries, describeDiscardChanges } from '../src/lib/discardSummary';

const observation = (scientificName: string, commonName: string, count = 1): DraftObservation => ({
  scientificName,
  commonName,
  count,
  requestedSpecies: '',
  freeTags: '',
});

const draft = (observations: DraftObservation[], patch: Partial<DraftRecord> = {}): DraftRecord => ({
  id: 'b::p::p/IMG001.JPG',
  bucket: 'b',
  uploadPrefix: 'p/',
  mediaPath: 'p/IMG001.JPG',
  deploymentId: 'd',
  observations,
  questionable: false,
  timeOverride: null,
  lastEdited: '2026-01-01T00:00:00Z',
  dirty: true,
  ...patch,
});

describe('describeDiscardChanges', () => {
  it('describes additions, removals, and count changes against canonical observations', () => {
    const base = [observation('Odocoileus hemionus', 'Mule Deer', 2), observation('Puma concolor', 'Puma')];
    const edited = draft([
      observation('Odocoileus hemionus', 'Mule Deer', 4),
      observation('Canis latrans', 'Coyote'),
    ]);
    expect(describeDiscardChanges(edited, base).map((change) => change.label)).toEqual([
      'Mule Deer count 2 → 4',
      'Removed Puma',
      'Added Coyote',
    ]);
  });

  it('describes detag and Ghost replacement as canonical removals and an addition', () => {
    const base = [observation('Odocoileus hemionus', 'Mule Deer')];
    expect(describeDiscardChanges(draft([]), base).map((change) => change.label)).toEqual([
      'Removed Mule Deer',
    ]);
    expect(
      describeDiscardChanges(draft([observation('Casper', 'Ghost')]), base).map((change) => change.label),
    ).toEqual(['Removed Mule Deer', 'Added Ghost']);
  });

  it('includes questionable and timestamp changes alongside species changes', () => {
    const edited = draft([observation('Canis latrans', 'Coyote')], {
      questionable: true,
      timeOverride: '2026-01-02T03:04:05Z',
    });
    expect(describeDiscardChanges(edited, []).map((change) => change.label)).toEqual([
      'Added Coyote',
      'Marked Need expert',
      'Timestamp changed to 2026-01-02T03:04:05Z',
    ]);
  });

  it('does not mislabel an empty no-op draft as a questionable edit', () => {
    expect(describeDiscardChanges(draft([]), [])).toEqual([]);
  });

  it('does not report a timestamp override equal to the restored canonical timestamp', () => {
    const timestamp = '2026-01-02T03:04:05Z';
    expect(
      describeDiscardChanges(draft([], { timeOverride: timestamp }), [], timestamp),
    ).toEqual([]);
  });
});

describe('buildDiscardSummaries', () => {
  it('uses the canonical image state and disambiguates duplicate basenames with media paths', () => {
    const first = draft([observation('Canis latrans', 'Coyote')], { mediaPath: 'a/IMG001.JPG', id: 'a' });
    const second = draft([], { mediaPath: 'b/IMG001.JPG', id: 'b' });
    const summaries = buildDiscardSummaries([first, second], [
      { key: 'a/IMG001.JPG', fileName: 'IMG001.JPG', baseObservations: [] },
      { key: 'b/IMG001.JPG', fileName: 'IMG001.JPG', baseObservations: [observation('Puma concolor', 'Puma')] },
    ]);
    expect(summaries.map((summary) => summary.displayName)).toEqual(['a/IMG001.JPG', 'b/IMG001.JPG']);
    expect(summaries[1].changes[0].label).toBe('Removed Puma');
  });
});
