// Ported from apps/sparcd-explorer/tests/test_species_counts.py. One change of
// meaning: location 0000 now stays in every count (spec §5), so its species
// counts too; it still never reaches the map.

import { describe, expect, it } from 'vitest';
import { locationRows, speciesRows, summarize } from '../../src/data';
import { areaOfHex, binsOf, collection, deployment, filter, hexOfSite, media, modelOf, observation } from '../support/fixtures';

const grouped = { separate: false };

const model = modelOf(
  collection()
    .upload('u1', {
      deployments: [deployment('AAA01', 'Alpha', 12.0, -100.0)],
      media: [media('u1', 'owl.jpg', 'AAA01', '2024-01-01T10:00:00')],
      observations: [observation('u1', 'owl.jpg', 'AAA01', '2024-01-01T10:00:00', { common: 'Owl', scientific: 'Strigiformes' })],
    })
    .upload('u2', {
      deployments: [deployment('BBB01', 'Bravo', 13.0, -101.0)],
      media: [media('u2', 'deer.jpg', 'BBB01', '2024-01-02T10:00:00')],
      // A common name with no scientific name.
      observations: [observation('u2', 'deer.jpg', 'BBB01', '2024-01-02T10:00:00', { common: 'Deer' })],
    })
    .upload('u3', {
      deployments: [deployment('0000', 'Unknown', 11.0, -99.0)],
      media: [media('u3', 'pig.jpg', '0000', '2024-01-03T10:00:00')],
      observations: [observation('u3', 'pig.jpg', '0000', '2024-01-03T10:00:00', { common: 'Javelina', scientific: 'Pecari tajacu' })],
    }),
);

describe('test_species_counts', () => {
  it('the summary’s species count matches the species table', () => {
    const result = filter(model);
    const rows = speciesRows(model, result, grouped);
    expect(summarize(model, result, grouped).species).toBe(rows.length);
    expect(new Set(rows.map((r) => model.species[r.species].name))).toEqual(new Set(['Owl', 'Deer', 'Javelina']));
    // The map holds only the placed sites' species.
    expect(binsOf(model, result).reduce((n, b) => n + b.richness, 0)).toBe(2);
  });

  it('the hex panel and the summary agree for a clicked hex', () => {
    const bravoHex = hexOfSite(model, model.sites.findIndex((s) => s.name === 'Bravo'));
    const result = filter(model, { area: areaOfHex(model, bravoHex) });
    const bin = binsOf(model, result).find((b) => b.locationNames.includes('Bravo'))!;
    expect(bin.richness).toBe(1);
    expect(summarize(model, result, grouped).species).toBe(1);
    expect(locationRows(model, result, grouped)[0].species).toBe(1);
  });

  it('a hex counts distinct species, not observations', () => {
    const tagged = [
      ['owl1.jpg', 'Owl'],
      ['deer.jpg', 'Deer'],
      ['owl2.jpg', 'Owl'],
    ];
    const m = modelOf(
      collection().upload('u1', {
        deployments: [deployment('CCC01', 'Charlie', 14.0, -102.0)],
        media: tagged.map(([file]) => media('u1', file, 'CCC01', '2024-01-01T10:00:00')),
        observations: tagged.map(([file, common]) => observation('u1', file, 'CCC01', '2024-01-01T10:00:00', { common })),
      }),
    );
    expect(binsOf(m, filter(m)).map((b) => b.richness)).toEqual([2]);
  });
});
