// Ported from apps/sparcd-explorer/tests/test_site_selection.py. Two sites
// share the ID ZZZ19, as some registry entries do.

import { describe, expect, it } from 'vitest';
import { hexBins, summarize } from '../../src/data';
import { collection, deployment, fileNames, filter, media, modelOf, observation, siteNamed } from '../support/fixtures';

const TS = '2024-01-01T10:00:00';

function siteUpload(c: ReturnType<typeof collection>, upload: string, name: string, lat: number, files: string[]) {
  return c.upload(upload, {
    deployments: [deployment('ZZZ19', name, lat, -100.0)],
    media: files.map((f) => media(upload, f, 'ZZZ19', TS)),
    observations: files.map((f) => observation(upload, f, 'ZZZ19', TS, { common: 'Owl', scientific: 'Strigiformes' })),
  });
}

const model = modelOf(siteUpload(siteUpload(collection(), 'u1', 'Ridge-3', 12.0, ['n1.jpg', 'n2.jpg', 'n3.jpg']), 'u2', 'Ridge-3 old', 12.6, ['o1.jpg', 'o2.jpg']));

describe('test_site_selection', () => {
  it('clicking a hex shows only its site', () => {
    const hex = model.sites[siteNamed(model, 'Ridge-3 old')].hex!;
    const result = filter(model, { area: { hexes: [hex], boxes: [] } });
    expect(summarize(model, result, { separate: false })).toMatchObject({ photos: 2, tagged: 2 });
    expect(fileNames(model, result.photos)).toEqual(['o1.jpg', 'o2.jpg']);
  });

  it('clicking a site point shows only its site', () => {
    const result = filter(model, { locations: [model.sites[siteNamed(model, 'Ridge-3')].key] });
    expect(result.photos).toHaveLength(3);
    expect(fileNames(model, result.photos)).toEqual(['n1.jpg', 'n2.jpg', 'n3.jpg']);
  });

  it('hex counts stay with their own site', () => {
    const counts = Object.fromEntries(hexBins(model, filter(model)).map((b) => [b.locationNames[0], b.tagged]));
    expect(counts).toEqual({ 'Ridge-3': 3, 'Ridge-3 old': 2 });
  });
});
