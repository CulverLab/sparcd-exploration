import { describe, expect, it } from 'vitest';
import { reviewStatus, reviewSummary } from '../src/lib/effective';
import type { DraftObservation } from '../src/lib/db';

const observation = (reviewEvents?: DraftObservation['reviewEvents']): DraftObservation => ({
  scientificName: 'Canis latrans',
  commonName: 'Coyote',
  count: 1,
  requestedSpecies: '',
  freeTags: '',
  reviewEvents,
});

describe('identification review status', () => {
  it('does not infer review from original attribution', () => {
    expect(reviewStatus({ ...observation(), classifiedBy: 'fielduser' })).toBe('unreviewed');
  });

  it('recognizes a recorded review event', () => {
    expect(reviewStatus(observation([{ reviewedBy: 'harold', reviewedAt: '2024-01-02T09:00:00.000Z' }]))).toBe('reviewed');
  });

  it('summarizes empty, uniform, and mixed image states', () => {
    expect(reviewSummary([])).toBeNull();
    expect(reviewSummary([observation()])).toBe('unreviewed');
    expect(reviewSummary([observation([{ reviewedBy: 'harold', reviewedAt: '2024-01-02T09:00:00.000Z' }])])).toBe('reviewed');
    expect(
      reviewSummary([
        observation([{ reviewedBy: 'harold', reviewedAt: '2024-01-02T09:00:00.000Z' }]),
        observation(),
      ]),
    ).toBe('mixed');
  });
});
