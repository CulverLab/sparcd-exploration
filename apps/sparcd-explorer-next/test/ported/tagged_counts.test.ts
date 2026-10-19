// Ported from apps/sparcd-explorer/tests/test_tagged_counts.py.

import { describe, expect, it } from 'vitest';
import { locationRows, photosForTag, summarize } from '../../src/data';
import { collection, deployment, fileNames, filter, media, modelOf, observation } from '../support/fixtures';

const TS = '2024-01-01T10:00:00';

const model = modelOf(
  collection().upload('u1', {
    deployments: [deployment('AAA01', 'Alpha', 12.0, -100.0)],
    media: ['owl', 'blank', 'empty'].map((name) => media('u1', `${name}.jpg`, 'AAA01', TS)),
    observations: [
      observation('u1', 'owl.jpg', 'AAA01', TS, { common: 'Owl', scientific: 'Strigiformes' }),
      // The uploader's placeholder is typed blank; sparcd-web leaves the type empty.
      { ...observation('u1', 'blank.jpg', 'AAA01', TS), observationType: 'blank' },
      { ...observation('u1', 'empty.jpg', 'AAA01', TS), count: undefined },
    ],
  }),
);
const alphaHex = model.sites[0].hex!;
const clicked = filter(model, { area: { hexes: [alphaHex], boxes: [] } });

describe('test_tagged_counts', () => {
  it('placeholder rows count as untagged', () => {
    const [row] = locationRows(model, filter(model), { separate: false });
    expect([row.photos, row.tagged]).toEqual([3, 1]);
    const all = summarize(model, filter(model), { separate: false });
    expect([all.photos, all.tagged]).toEqual([3, 1]);
    const inHex = summarize(model, clicked, { separate: false });
    expect([inHex.photos, inHex.tagged, inHex.photos - inHex.tagged]).toEqual([3, 1, 2]);
  });

  it('the tagged-only grid leaves placeholders out', () => {
    expect(fileNames(model, photosForTag(model, clicked.photos, 'tagged'))).toEqual(['owl.jpg']);
  });
});
