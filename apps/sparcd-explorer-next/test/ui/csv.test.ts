import { describe, expect, it } from 'vitest';
import { locationRows, photoRows } from '../../src/data';
import { csvColumns, csvFileName, toCsv } from '../../src/lib/csv';
import type { Display } from '../../src/lib/format';
import { locationColumns, photoColumns, type Col } from '../../src/lib/tables';
import { collection, deployment, filter, media, modelOf, observation } from '../support/fixtures';

const model = modelOf(
  collection('Alpha Basin', 'aaa')
    .upload('u1', {
      deployments: [deployment('AA01', 'Spring, "upper"', 12.56789, -100.23456, 1000)],
      media: [media('u1', 'a.jpg', 'AA01', '2023-01-01T22:10:00'), media('u1', 'b.jpg', 'AA01', '2023-01-02T10:00:00')],
      observations: [observation('u1', 'a.jpg', 'AA01', '', { common: 'Bobcat', scientific: 'Lynx rufus', count: 2 })],
    })
    .upload('u2', {
      deployments: [deployment('0000', '', null, null, null)],
      media: [media('u2', 'c.jpg', '0000', '2024-01-01T10:00:00')],
    }),
);
const result = filter(model);
const grouping = { separate: false };
const display = (d: Partial<Display> = {}): Display => ({
  coords: 'latlon',
  precision: { method: 'round', digits: 3 },
  elevation: 'm',
  ...d,
});

const csvOf = <R>(defs: Col<R>[], shown: string[], rows: R[], d: Display) =>
  toCsv(csvColumns(defs, shown, d), rows).trimEnd().split('\r\n');

describe('CSV columns', () => {
  const defs = locationColumns({ model, display: display(), totalDetections: 0 });

  it('split Coordinates into latitude and longitude, or zone, easting and northing', () => {
    expect(csvColumns(defs, ['name', 'coords', 'photos'], display()).map((c) => c.id)).toEqual(['name', 'lat', 'lon', 'photos']);
    expect(csvColumns(defs, ['name', 'coords'], display({ coords: 'utm' })).map((c) => c.id)).toEqual([
      'name',
      'zone',
      'easting',
      'northing',
    ]);
  });

  it('add coordinates when no coordinate column is shown, and leave the Activity drawing out', () => {
    expect(csvColumns(defs, ['name', 'activity', 'photos'], display()).map((c) => c.id)).toEqual(['name', 'photos', 'lat', 'lon']);
  });

  it('keep the columns shown when one coordinate part is shown already', () => {
    expect(csvColumns(defs, ['easting', 'name'], display()).map((c) => c.id)).toEqual(['easting', 'name']);
  });
});

describe('CSV content', () => {
  it('writes the rows in view with coordinates at the display precision', () => {
    const d = display({ precision: { method: 'truncate', digits: 2 } });
    const defs = locationColumns({ model, display: d, totalDetections: 0 });
    const rows = locationRows(model, result, grouping);
    const lines = csvOf(defs, ['name', 'id', 'coords', 'elev', 'photos', 'days'], rows, d);
    expect(lines).toEqual([
      'Location,Location ID,Latitude,Longitude,Elevation (m),Photos,Active days',
      '"Spring, ""upper""",AA01,12.56,-100.23,1000,2,2',
      'No location set,0000,,,,1,1',
    ]);
  });

  it('writes elevation in feet and UTM as plain integers', () => {
    const d = display({ coords: 'utm', elevation: 'ft', precision: { method: 'round', digits: 2 } });
    const defs = locationColumns({ model, display: d, totalDetections: 0 });
    const [header, row] = csvOf(defs, ['id', 'coords', 'elev'], locationRows(model, result, grouping), d);
    expect(header).toBe('Location ID,UTM zone,Easting,Northing,Elevation (ft)');
    const [, zone, easting, northing, feet] = row.split(',');
    expect(zone).toBe('14N');
    expect(easting).toMatch(/^\d+000$/);
    expect(northing).toMatch(/^\d+000$/);
    expect(feet).toBe('3281');
  });

  it('writes photos with species joined, an empty cell for untagged, and coordinates', () => {
    const d = display();
    const defs = photoColumns({ model, display: d, totalDetections: 0 });
    const lines = csvOf(defs, ['time', 'species', 'count', 'tagged'], photoRows(model, result.photos, result.detections), d);
    expect(lines).toEqual([
      'Date and time,Species,Count,Tagged,Latitude,Longitude',
      '2023-01-01 22:10:00,Bobcat,2,Yes,12.568,-100.235',
      '2023-01-02 10:00:00,,,No,12.568,-100.235',
      '2024-01-01 10:00:00,,,No,,',
    ]);
  });
});

describe('CSV text a spreadsheet would run as a formula', () => {
  const risky = modelOf(
    collection('Risky', 'rrr').upload('u1', {
      deployments: [deployment('-12', '=1+1', 12.5, -100.25, 1000)],
      media: [media('u1', '@a.jpg', '-12', '2023-01-01T10:00:00')],
      observations: [observation('u1', '@a.jpg', '-12', '', { common: '-Bobcat', scientific: 'Lynx rufus' })],
    }),
  );
  const r = filter(risky);

  it('opens as text, while negative coordinates and number-like IDs stay plain numbers', () => {
    const d = display({ precision: { method: 'round', digits: 2 } });
    const defs = locationColumns({ model: risky, display: d, totalDetections: 1 });
    const [, row] = csvOf(defs, ['name', 'id', 'coords'], locationRows(risky, r, grouping), d);
    expect(row).toBe("'=1+1,-12,12.5,-100.25");
  });

  it('guards photo file names and species too', () => {
    const d = display();
    const defs = photoColumns({ model: risky, display: d, totalDetections: 1 });
    const [, row] = csvOf(defs, ['file', 'species', 'coords'], photoRows(risky, r.photos, r.detections), d);
    expect(row).toBe("'@a.jpg,'-Bobcat,12.5,-100.25");
  });
});

describe('CSV file name', () => {
  const day = new Date(2026, 9, 19);
  it('names the collections, the date and the view', () => {
    expect(csvFileName(['Alpha Basin'], 'locations', day)).toBe('alpha-basin-2026-10-19-locations.csv');
    expect(csvFileName(['Alpha Basin', 'Bravo Flats'], 'photos', day)).toBe('alpha-basin-and-bravo-flats-2026-10-19-photos.csv');
    expect(csvFileName(['Alpha', 'Bravo', 'Charlie'], 'species', day)).toBe('alpha-and-2-more-2026-10-19-species.csv');
    expect(csvFileName(['Cañon Seco'], 'locations', day)).toBe('canon-seco-2026-10-19-locations.csv');
  });
});
