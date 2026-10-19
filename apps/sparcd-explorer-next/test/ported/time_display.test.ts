// Ported from apps/sparcd-explorer/tests/test_time_display.py.

import { describe, expect, it } from 'vitest';
import { detectionRows, formatTimestamp24, photoRows } from '../../src/data';
import { collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

describe('test_time_display', () => {
  it('renders late hours without AM/PM', () => {
    const rendered = formatTimestamp24('2026-09-11T22:15:10.000Z');
    expect(rendered).toBe('2026-09-11 22:15:10');
    expect(rendered).not.toMatch(/AM|PM/);
  });

  it('shows a missing timestamp as empty', () => {
    expect(formatTimestamp24(null)).toBe('');
  });

  it('the photo and detection tables convert timestamp values', () => {
    const late = '2026-09-11T22:15:10.000-07:00';
    const model = modelOf(
      collection().upload('u1', {
        deployments: [deployment('AA01', 'Alpha', 12.5, -100.25)],
        media: [media('u1', 'late.jpg', 'AA01', late)],
        observations: [observation('u1', 'late.jpg', 'AA01', late, { common: 'Owl' })],
      }),
    );
    const result = filter(model);
    expect(photoRows(model, result.photos)[0].time).toBe('2026-09-11 22:15:10');
    expect(detectionRows(model, result.detections)).toEqual([
      expect.objectContaining({ fileName: 'late.jpg', species: 'Owl', time: '2026-09-11 22:15:10', date: '2026-09-11' }),
    ]);
    expect(detectionRows(model, result.detections)[0].time).not.toMatch(/AM|PM/);
  });
});
