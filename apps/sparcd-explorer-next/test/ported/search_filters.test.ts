// Ported from apps/sparcd-explorer/tests/test_search_filters.py.

import { describe, expect, it } from 'vitest';
import { onlySpecies, summarize, type FilterState } from '../../src/data';
import { collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

const fixture = () =>
  collection()
    .upload('u1', {
      deployments: [deployment('AAA01', 'Alpha', 12.0, -100.0)],
      media: [
        media('u1', 'june.jpg', 'AAA01', '2018-06-15T10:00:00'),
        media('u1', 'july.jpg', 'AAA01', '2018-07-15T10:00:00'),
        media('u1', 'no-rows.jpg', 'AAA01', '2018-06-20T10:00:00'),
        media('u1', 'placeholder.jpg', 'AAA01', '2018-06-21T10:00:00'),
      ],
      observations: [
        observation('u1', 'june.jpg', 'AAA01', '2018-06-15T10:00:00', { common: 'Owl' }),
        observation('u1', 'july.jpg', 'AAA01', '2018-07-15T10:00:00', { common: 'Owl' }),
        observation('u1', 'placeholder.jpg', 'AAA01', '2018-06-21T10:00:00'),
      ],
    })
    .upload('u2', {
      deployments: [deployment('BBB01', 'Bravo', 13.0, -101.0)],
      media: [media('u2', 'later.jpg', 'BBB01', '2024-12-01T10:00:00')],
    });

function sitesAndImages(state: Partial<FilterState> = {}): [number, number] {
  const model = modelOf(fixture());
  const s = summarize(model, filter(model, state), { separate: false });
  return [s.locations, s.photos];
}

describe('test_search_filters', () => {
  it('the default view keeps every image', () => {
    expect(sitesAndImages()).toEqual([2, 5]);
  });

  it('a date range applies to every image', () => {
    // june.jpg by its date, no-rows.jpg with no observation rows, placeholder.jpg with a placeholder row.
    expect(sitesAndImages({ dateFrom: '2018-06-01', dateTo: '2018-06-30' })).toEqual([1, 3]);
  });

  it('a year dates images without rows by their media timestamp', () => {
    expect(sitesAndImages({ years: [2024] })).toEqual([1, 1]);
  });

  it('a species include filter leaves untagged images out', () => {
    // Locations count camera effort, as the Locations table lists them, so a
    // species filter leaves both cameras in.
    expect(sitesAndImages({ species: onlySpecies(modelOf(fixture()), ['Owl']) })).toEqual([2, 2]);
  });

  it('a malformed media date leaves the date bounds alone', () => {
    const model = modelOf(
      fixture().upload('u3', {
        deployments: [deployment('CCC01', 'Charlie', 14.0, -102.0)],
        media: [media('u3', 'odd.jpg', 'CCC01', '0000-00-00T00:00:00')],
      }),
    );
    expect(model.dateSpan).toEqual({ first: '2018-06-15', last: '2024-12-01' });
  });
});
