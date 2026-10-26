import { describe, expect, it } from 'vitest';
import { NO_FILTERS, dataChecks, locationRows } from '../../src/data';
import { describeCheck } from '../../src/lib/checkText';
import { locationColumns, locationFlagger } from '../../src/lib/tables';
import { collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

// AB01 moved between two uploads; AB-03 and AB03 look alike; AB01 is in both
// collections; one photo has no location.
const model = modelOf([
  collection('Alpha', 'aaa')
    .upload('u1', {
      deployments: [deployment('AB01', 'Willow', 10.1, -100.1)],
      media: [media('u1', 'a1.jpg', 'AB01', '2024-01-01T08:00:00')],
      observations: [observation('u1', 'a1.jpg', 'AB01', '', { common: 'Bobcat', scientific: 'Lynx rufus' })],
    })
    .upload('u2', {
      deployments: [deployment('AB01', 'Willow', 10.2, -100.2)],
      media: [media('u2', 'a2.jpg', 'AB01', '2024-02-01T08:00:00')],
      observations: [],
    })
    .upload('u3', {
      deployments: [deployment('AB-03', 'Juniper', 10.3, -100.3), deployment('AB03', 'Juniper', 10.3, -100.3), deployment('0000', '', null, null)],
      media: [
        media('u3', 'a3.jpg', 'AB-03', '2024-03-01T08:00:00'),
        media('u3', 'a4.jpg', 'AB03', '2024-03-02T08:00:00'),
        media('u3', 'a5.jpg', '0000', '2024-03-03T08:00:00'),
      ],
      observations: [],
    }),
  collection('Bravo', 'bbb').upload('u1', {
    deployments: [deployment('AB01', 'Willow', 10.2, -100.2)],
    media: [media('u1', 'b1.jpg', 'AB01', '2024-04-01T08:00:00')],
    observations: [],
  }),
]);
const rows = locationRows(model, filter(model, NO_FILTERS), { separate: false });
const row = (id: string) => rows.find((r) => r.ids.includes(id))!;
const flags = locationFlagger(model);

describe("a location's flags", () => {
  it('say in plain words what "moved" and "similar ID" mean', () => {
    expect(flags(row('AB01')).map((f) => [f.label, f.tip])).toEqual([
      ['moved', 'This location has 2 positions in the data, so the camera was probably moved.'],
    ]);
    expect(flags(row('AB03')).map((f) => [f.label, f.tip])).toEqual([['similar ID', 'AB-03 and AB03 look like the same location.']]);
    expect(flags(row('0000')).map((f) => f.label)).toEqual(['no location']);
  });

  it('leave out "2 collections", which the Collection column says', () => {
    expect(row('AB01').collections).toHaveLength(2);
    expect(flags(row('AB01')).filter((f) => /collection/.test(f.label))).toEqual([]);
    const coll = locationColumns({ model, display: { coords: 'latlon', precision: { method: 'round', digits: 3 }, elevation: 'm' }, totalDetections: 0 }).find(
      (c) => c.id === 'coll',
    )!;
    expect(coll.value(row('AB01'))).toBe('2 collections');
  });

  it('each open the data check they come from', () => {
    const keys = dataChecks(model).map((c) => describeCheck(model, c).key);
    for (const r of rows) for (const f of flags(r)) expect(keys).toContain(f.check);
  });
});
