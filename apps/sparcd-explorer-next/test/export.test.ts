import { strFromU8, unzipSync } from 'fflate';
import { parseDeploymentsNullable, parseMedia, parseObservations } from '@sparcd/camtrap';
import { describe, expect, it } from 'vitest';
import { CAMTRAP_PROFILE, buildModel, camtrapPackage, csvFiles, detectionsTable, exportFileName, formulaSafe, locationsTable, onlySpecies, photosTable, precisionWords, resultForTag, speciesTable, spreadsheetTables, summaryTable, tableCsv, xlsxBlob, zipBlob, type Display, type ExportOptions, type FilterResult, type LoadedCollection, type Model, type ReportFacts } from '../src/data';
import { tableOrder } from '../src/lib/tables';
import { collection, deployment, filter, media, observation } from './support/fixtures';

const alpha = collection('Alpha Basin', 'aaa')
  .upload('u1', {
    deployments: [deployment('AA01', 'Spring, "upper"', 12.56789, -100.23456, 1000)],
    media: [media('u1', 'a.jpg', 'AA01', '2023-01-01T22:10:00'), media('u1', 'b.jpg', 'AA01', '2023-01-02T10:00:00')],
    observations: [
      observation('u1', 'a.jpg', 'AA01', '', { common: 'Bobcat', scientific: 'Lynx rufus', count: 2 }),
      observation('u1', 'a.jpg', 'AA01', '', { common: 'Coyote', scientific: 'Canis latrans' }),
      observation('u1', 'b.jpg', 'AA01'),
    ],
  })
  .upload('u2', {
    deployments: [deployment('0000', '', null, null, null)],
    media: [media('u2', 'c.jpg', '0000', '2024-01-01T10:00:00')],
  })
  .upload('u3', {
    deployments: [deployment('AA10', 'Wash', 12.4, -100.5, 1500)],
    media: [media('u3', 'd.jpg', 'AA10', '2024-02-01T06:00:00')],
    observations: [observation('u3', 'd.jpg', 'AA10', '', { common: 'Bobcat', scientific: 'Lynx rufus' })],
  });
const bravo = collection('Bravo Flats', 'bbb').upload('v1', {
  deployments: [deployment('BB01', 'Mesa', 12.7, -100.1, 900)],
  media: [media('v1', 'e.jpg', 'BB01', '2024-03-01T12:00:00')],
  observations: [observation('v1', 'e.jpg', 'BB01', '', { common: 'Coyote', scientific: 'Canis latrans' })],
});

const one = [alpha.build()];
const model = buildModel(one);
const both = [alpha.build(), bravo.build()];
const multiModel = buildModel(both);

const opts = (o: Partial<ExportOptions> = {}): ExportOptions => ({
  coords: 'latlon',
  precision: { method: 'round', digits: 2 },
  elevation: 'm',
  separate: false,
  ...o,
});
const facts: ReportFacts = {
  collections: 'Alpha Basin',
  filters: 'No filters: all photos',
  prepared: '2026-10-19',
  preparedBy: 'fieldlead',
  coordinates: 'Coordinates rounded to 2 decimal places',
};
const column = (t: { columns: string[]; rows: unknown[][] }, name: string) => t.rows.map((r) => r[t.columns.indexOf(name)]);
const unzip = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe('the Locations sheet', () => {
  it('lists every location in view by ID, no location last, at the display precision', () => {
    const t = locationsTable(model, filter(model), opts());
    expect(t.columns).toEqual([
      'Location ID',
      'Location',
      'Mountain range',
      'Latitude',
      'Longitude',
      'Elevation (m)',
      'Photos',
      'Tagged',
      'Detections',
      'Species',
      'Active days',
      'First photo',
      'Last photo',
    ]);
    expect(t.rows).toEqual([
      ['AA01', 'Spring, "upper"', 'AA0', 12.57, -100.23, 1000, 2, 1, 2, 2, 2, '2023-01-01', '2023-01-02'],
      ['AA10', 'Wash', 'AA1', 12.4, -100.5, 1500, 1, 1, 1, 1, 1, '2024-02-01', '2024-02-01'],
      ['0000', 'No location set', null, null, null, null, 1, 0, 0, 0, 1, '2024-01-01', '2024-01-01'],
    ]);
  });

  it('truncates when the display truncates, and never shows more digits than chosen', () => {
    const t = locationsTable(model, filter(model), opts({ precision: { method: 'truncate', digits: 1 } }));
    expect(column(t, 'Latitude').slice(0, 2)).toEqual([12.5, 12.4]);
    expect(column(t, 'Longitude').slice(0, 2)).toEqual([-100.2, -100.5]);
  });

  it('writes UTM as whole metres at the same precision, and elevation in feet when chosen', () => {
    const t = locationsTable(model, filter(model), opts({ coords: 'utm', elevation: 'ft' }));
    expect(t.columns.slice(3, 7)).toEqual(['UTM zone', 'Easting', 'Northing', 'Elevation (ft)']);
    const [zone, easting, northing, elevation] = t.rows[0].slice(3, 7);
    expect(zone).toBe('14N');
    expect(Number.isInteger(easting) && Number.isInteger(northing)).toBe(true);
    expect([(easting as number) % 1000, (northing as number) % 1000]).toEqual([0, 0]);
    expect(elevation).toBe(3281);
  });

  it('names the collections when several are open', () => {
    const t = locationsTable(multiModel, filter(multiModel), opts());
    expect(t.columns[0]).toBe('Collection');
    expect(column(t, 'Collection')).toEqual(['Alpha Basin', 'Alpha Basin', 'Bravo Flats', 'Alpha Basin']);
  });
});

describe('the Species, Photos and Detections sheets', () => {
  it('Species: most detected first, common and scientific names', () => {
    const t = speciesTable(model, filter(model), opts());
    expect(t.rows).toEqual([
      ['Bobcat', 'Lynx rufus', 2, 3, 2, 2, '2023-01-01', '2024-02-01'],
      ['Coyote', 'Canis latrans', 1, 1, 1, 1, '2023-01-01', '2023-01-01'],
    ]);
  });

  it('Photos: one row per photo in time order, species joined, coordinates at the display precision', () => {
    const t = photosTable(model, filter(model), opts());
    expect(column(t, 'File name')).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    expect(t.rows[0].slice(0, 8)).toEqual(['2023-01-01 22:10:00', 'a.jpg', 'Bobcat, Coyote', 'Lynx rufus, Canis latrans', 3, 'Yes', 'AA01', 'Spring, "upper"']);
    expect(t.rows[1].slice(2, 6)).toEqual([null, null, null, 'No']);
    expect(t.rows[2].slice(6, 10)).toEqual(['0000', 'No location set', null, null]);
    expect(column(t, 'Latitude')[0]).toBe(12.57);
  });

  it('follow the filters: a species filter keeps its photos, and their other species out', () => {
    const result = filter(model, { species: onlySpecies(model, ['Lynx rufus']) });
    expect(column(photosTable(model, result, opts()), 'Species')).toEqual(['Bobcat', 'Bobcat']);
    const d = detectionsTable(model, result, opts());
    expect(column(d, 'Common name')).toEqual(['Bobcat', 'Bobcat']);
    expect(column(d, 'Count')).toEqual([2, 1]);
  });
});

describe('the Summary sheet', () => {
  it('says what the report covers, then the numbers in view', () => {
    const t = summaryTable(model, filter(model), opts(), facts);
    expect(t.rows.slice(0, 6)).toEqual([
      ['Collections', 'Alpha Basin'],
      ['Filters', 'No filters: all photos'],
      ['Prepared', '2026-10-19'],
      ['Prepared by', 'fieldlead'],
      ['Coordinates', 'Coordinates rounded to 2 decimal places'],
      ['Elevation', 'Metres'],
    ]);
    expect(Object.fromEntries(t.rows.slice(6))).toEqual({
      Locations: 3,
      Photos: 4,
      'Tagged photos': 2,
      'Untagged photos': 2,
      Detections: 3,
      Species: 2,
      'Animals counted': 4,
      'Active days': 4,
      'First photo': '2023-01-01',
      'Last photo': '2024-02-01',
    });
  });

  it('adds the totals by collection when several are open, less those the Collections filter unticks', () => {
    const others = multiModel.collections.filter((c) => c.name !== 'Bravo Flats').map((c) => c.key);
    const t = summaryTable(multiModel, filter(multiModel), opts(), facts, others);
    const at = t.rows.findIndex((r) => r[0] === 'By collection');
    expect(t.rows.slice(at + 1)).toEqual([
      ['Collection', 'Locations', 'Photos', 'Tagged', 'Detections', 'Species', 'First photo', 'Last photo'],
      ['Bravo Flats', 1, 1, 1, 1, 1, '2024-03-01', '2024-03-01'],
    ]);
  });
});

describe('CSV files', () => {
  it('quote what needs quoting and end every line with CRLF', () => {
    const lines = tableCsv(locationsTable(model, filter(model), opts())).split('\r\n');
    expect(lines[1]).toBe('AA01,"Spring, ""upper""",AA0,12.57,-100.23,1000,2,1,2,2,2,2023-01-01,2023-01-02');
    expect(lines.at(-1)).toBe('');
  });

  it('zip as locations, species, photos and detections', async () => {
    const files = await unzip(await zipBlob(csvFiles(model, filter(model), opts())));
    expect(Object.keys(files)).toEqual(['locations.csv', 'species.csv', 'photos.csv', 'detections.csv']);
    expect(strFromU8(files['species.csv']).split('\r\n')[1]).toBe('Bobcat,Lynx rufus,2,3,2,2,2023-01-01,2024-02-01');
    expect(strFromU8(files['locations.csv'])).not.toContain('12.56789');
  });
});

describe('the spreadsheet', () => {
  it('has the sheets Summary, Locations, Species, Photos and Detections, with coordinates at the display precision', async () => {
    const files = await unzip(await xlsxBlob(spreadsheetTables(model, filter(model), opts(), facts)));
    const workbook = strFromU8(files['xl/workbook.xml']);
    expect([...workbook.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => m[1])).toEqual([
      'Summary',
      'Locations',
      'Species',
      'Photos',
      'Detections',
    ]);
    const sheets = Object.keys(files).filter((f) => f.startsWith('xl/worksheets/sheet')).map((f) => strFromU8(files[f]));
    const all = sheets.join('') + strFromU8(files['xl/sharedStrings.xml'] ?? new Uint8Array());
    expect(all).toContain('>12.57<');
    expect(all).toContain('>-100.23<');
    expect(all).not.toMatch(/12\.5678|100\.2345/);
  });
});

describe('the Camtrap DP package', () => {
  const pack = (result = filter(model), digits: number | null = 2) =>
    camtrapPackage(model, one, result, { coords: 'latlon', precision: { method: 'round', digits }, elevation: 'm' }, {
      name: 'alpha-basin-2026-10-19',
      title: 'Alpha Basin',
      created: '2026-10-19T12:00:00.000Z',
      contributor: 'fieldlead',
      filters: 'No filters: all photos',
    });

  it('holds deployments, media, observations and datapackage.json', async () => {
    const files = await unzip(await zipBlob(pack()));
    expect(Object.keys(files)).toEqual(['deployments.csv', 'media.csv', 'observations.csv', 'datapackage.json']);
  });

  it('writes deployments with coordinates at the display precision, a blank where there are none', () => {
    const deployments = parseDeploymentsNullable(pack()['deployments.csv']);
    expect(deployments.map((d) => [d.locationId, d.latitude, d.longitude])).toEqual([
      ['AA01', 12.57, -100.23],
      ['0000', null, null],
      ['AA10', 12.4, -100.5],
    ]);
    expect(pack()['deployments.csv']).not.toContain('12.567890');
  });

  it('keeps only the photos in view, and leaves out a species the filters hide', () => {
    const files = pack(filter(model, { species: onlySpecies(model, ['Lynx rufus']) }));
    expect(parseMedia(files['media.csv']).map((m) => m.fileName)).toEqual(['a.jpg', 'd.jpg']);
    expect(parseObservations(files['observations.csv']).map((o) => o.scientificName)).toEqual(['Lynx rufus', 'Lynx rufus']);
    expect(parseDeploymentsNullable(files['deployments.csv']).map((d) => d.locationId)).toEqual(['AA01', 'AA10']);
  });

  it('keeps every observation row of a photo in view when no species is filtered, placeholders without a count', () => {
    const rows = pack()['observations.csv'].trim().split('\n');
    expect(rows).toHaveLength(4);
    expect(rows[2]).toContain('"blank","false","","","",""');
  });

  it('describes itself with the Camtrap DP profile, its three resources and the coordinate precision', () => {
    const dp = JSON.parse(pack()['datapackage.json']);
    expect(dp.profile).toBe(CAMTRAP_PROFILE);
    for (const key of ['name', 'created', 'contributors', 'project', 'spatial', 'temporal', 'taxonomic', 'resources']) expect(dp).toHaveProperty(key);
    expect(dp.resources.map((r: { name: string; path: string }) => [r.name, r.path])).toEqual([
      ['deployments', 'deployments.csv'],
      ['media', 'media.csv'],
      ['observations', 'observations.csv'],
    ]);
    for (const r of dp.resources) {
      expect(r).toMatchObject({ profile: 'tabular-data-resource', format: 'csv', dialect: { header: false } });
      expect(r.schema).toMatch(/^https:\/\/raw\.githubusercontent\.com\/tdwg\/camtrap-dp\/0\.1\.6\/\w+-table-schema\.json$/);
    }
    expect(dp.project).toMatchObject({ samplingDesign: 'opportunistic', captureMethod: ['motion detection'], classificationLevel: 'media' });
    expect(dp.temporal).toEqual({ start: '2023-01-01', end: '2024-02-01' });
    expect(dp.taxonomic.map((t: { scientificName: string }) => t.scientificName)).toEqual(['Canis latrans', 'Lynx rufus']);
    expect(dp.description).toContain('Coordinates rounded to 2 decimal places in deployments.csv');
    expect(dp.spatial).toEqual({
      type: 'Polygon',
      coordinates: [[[-100.5, 12.4], [-100.23, 12.4], [-100.23, 12.57], [-100.5, 12.57], [-100.5, 12.4]]],
    });
  });

  it('says so when the coordinates are exact', () => {
    expect(JSON.parse(pack(filter(model), null)['datapackage.json']).description).toContain('Coordinates in deployments.csv are exact.');
  });
});

describe('export file names', () => {
  const day = new Date(2026, 9, 9);
  it('use the collection name, or "combined" for several', () => {
    expect(exportFileName(['Alpha Basin'], 'report.xlsx', day)).toBe('alpha-basin-2026-10-09-report.xlsx');
    expect(exportFileName(['Ciénega del Río'], 'csv.zip', day)).toBe('cienega-del-rio-2026-10-09-csv.zip');
    expect(exportFileName(['Alpha Basin', 'Bravo Flats'], 'camtrap-dp.zip', day)).toBe('combined-2026-10-09-camtrap-dp.zip');
    expect(exportFileName(['***'], 'csv.zip', day)).toBe('collection-2026-10-09-csv.zip');
  });
});

describe('the coordinate precision in words', () => {
  it('reads as people say it', () => {
    expect(precisionWords('latlon', { method: 'round', digits: 2 })).toBe('Coordinates rounded to 2 decimal places');
    expect(precisionWords('latlon', { method: 'truncate', digits: 1 })).toBe('Coordinates truncated to 1 decimal place');
    expect(precisionWords('latlon', { method: 'round', digits: 0 })).toBe('Coordinates rounded to whole degrees');
    expect(precisionWords('latlon', { method: 'round', digits: null })).toBe('Exact coordinates');
    expect(precisionWords('utm', { method: 'round', digits: 2 })).toBe('UTM, rounded to 1,000 m');
    expect(precisionWords('utm', { method: 'truncate', digits: 5 })).toBe('UTM, truncated to 1 m');
    expect(precisionWords('utm', { method: 'round', digits: null })).toBe('UTM, exact to the metre');
  });
});

// --- Positions, elevations, text, the tag switch, order and moved cameras --------

const latlon2: Display = { coords: 'latlon', precision: { method: 'round', digits: 2 }, elevation: 'm' };
const utm2: Display = { ...latlon2, coords: 'utm' };
const packageOf = (m: Model, loaded: LoadedCollection[], display: Display, result: FilterResult = filter(m)) =>
  camtrapPackage(m, loaded, result, display, { name: 'test', title: 'Test', created: '2026-10-19T12:00:00.000Z', contributor: 'fieldlead', filters: '' });

describe('elevation in every export is the elevation shown', () => {
  const loaded = [
    collection('Elevated', 'eee')
      .upload('u1', {
        deployments: [deployment('EL01', 'Ridge', 12.5, -100.25, 1000.123456)],
        media: [media('u1', 'a.jpg', 'EL01', '2023-01-01T10:00:00')],
      })
      .build(),
  ];
  const m = buildModel(loaded);

  it('writes whole metres to deployments.csv, never the source decimals', () => {
    const files = packageOf(m, loaded, latlon2);
    expect(parseDeploymentsNullable(files['deployments.csv'])[0].elevation).toBe(1000);
    expect(files['deployments.csv']).not.toContain('1000.123456');
  });

  it('converts the feet shown back to whole metres', () => {
    expect(parseDeploymentsNullable(packageOf(m, loaded, { ...latlon2, elevation: 'ft' })['deployments.csv'])[0].elevation).toBe(1000);
  });

  it('matches the tables in the spreadsheet and CSV files', () => {
    expect(column(locationsTable(m, filter(m), opts()), 'Elevation (m)')).toEqual([1000]);
    expect(column(locationsTable(m, filter(m), opts({ elevation: 'ft' })), 'Elevation (ft)')).toEqual([3281]);
  });
});

describe('with UTM shown, two cameras the table shows alike export alike', () => {
  // Both read 14N 366000 1389000 at 2 digits; in degrees they round apart (12.56 and 12.57).
  const loaded = [
    collection('Twins', 'ttt')
      .upload('u1', {
        deployments: [deployment('TW01', 'North', 12.5651, -100.23456, 1000)],
        media: [media('u1', 'a.jpg', 'TW01', '2023-01-01T10:00:00')],
      })
      .upload('u2', {
        deployments: [deployment('TW02', 'South', 12.5649, -100.23456, 1000)],
        media: [media('u2', 'b.jpg', 'TW02', '2023-01-02T10:00:00')],
      })
      .build(),
  ];
  const m = buildModel(loaded);
  const o = opts({ coords: 'utm' });

  it('in the Locations and Photos sheets', () => {
    const t = locationsTable(m, filter(m), o);
    expect(t.rows.map((r) => r.slice(3, 6))).toEqual([
      ['14N', 366000, 1389000],
      ['14N', 366000, 1389000],
    ]);
    const p = photosTable(m, filter(m), o);
    const at = ['UTM zone', 'Easting', 'Northing'].map((c) => p.columns.indexOf(c));
    expect(p.rows.map((r) => at.map((i) => r[i]).join(' '))).toEqual(['14N 366000 1389000', '14N 366000 1389000']);
  });

  it('in deployments.csv and the package coverage, as the shown UTM position converted back', () => {
    const files = packageOf(m, loaded, utm2);
    const [north, south] = parseDeploymentsNullable(files['deployments.csv']);
    expect([north.latitude, north.longitude]).toEqual([south.latitude, south.longitude]);
    expect(north.latitude).not.toBe(12.57);
    expect(files['deployments.csv']).not.toMatch(/12\.5651|12\.5649|100\.23456/);
    const dp = JSON.parse(files['datapackage.json']);
    expect(dp.spatial).toEqual({ type: 'Point', coordinates: [north.longitude, north.latitude] });
    expect(dp.description).toContain('UTM positions shown (UTM, rounded to 1,000 m), converted back to latitude and longitude');
  });

  it('while lat/long shown keeps them apart, as the table does', () => {
    const [north, south] = parseDeploymentsNullable(packageOf(m, loaded, latlon2)['deployments.csv']);
    expect([north.latitude, south.latitude]).toEqual([12.57, 12.56]);
  });
});

describe('text a spreadsheet would run as a formula exports as text', () => {
  const loaded = [
    collection('Risky', 'rrr')
      .upload('u1', {
        deployments: [deployment('-12', '=1+1', 12.5, -100.25, 1000)],
        media: [{ ...media('u1', '@a.jpg', '-12', '2023-01-01T10:00:00'), comments: '+cmd' }],
        observations: [observation('u1', '@a.jpg', '-12', '', { common: '-Bobcat', scientific: 'Lynx rufus' })],
      })
      .build(),
  ];
  const m = buildModel(loaded);

  it('prefixes =, +, -, @, tab and carriage return, and leaves plain numbers and other text alone', () => {
    expect(['=1+1', '+cmd', '-Bobcat', '@SUM(A1)', '\tx', '\rx'].map(formulaSafe)).toEqual([
      "'=1+1",
      "'+cmd",
      "'-Bobcat",
      "'@SUM(A1)",
      "'\tx",
      "'\rx",
    ]);
    expect(['-12', '-100.25', '+3', 'Willow', '', '2023-01-01'].map(formulaSafe)).toEqual(['-12', '-100.25', '+3', 'Willow', '', '2023-01-01']);
  });

  it('in the CSV files, with negative coordinates still plain numbers', () => {
    const lines = tableCsv(locationsTable(m, filter(m), opts())).split('\r\n');
    const cells = lines[1].split(',');
    expect(cells.slice(0, 2)).toEqual(['-12', "'=1+1"]);
    expect(cells.slice(3, 5)).toEqual(['12.5', '-100.25']);
    const species = tableCsv(speciesTable(m, filter(m), opts())).split('\r\n')[1];
    expect(species.startsWith("'-Bobcat,")).toBe(true);
    expect(tableCsv(photosTable(m, filter(m), opts()))).toContain(",'@a.jpg,");
  });

  it('in the spreadsheet, as string cells, never formulas, keeping the text as written', async () => {
    const files = await unzip(await xlsxBlob(spreadsheetTables(m, filter(m), opts(), facts)));
    const sheets = Object.keys(files).filter((f) => f.startsWith('xl/worksheets/sheet')).map((f) => strFromU8(files[f]));
    expect(sheets.join('')).not.toContain('<f>');
    const shared = [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((x) => x[1]);
    expect(shared).toContain('=1+1');
    expect(shared).toContain('-Bobcat');
    const locations = sheets[1];
    const nameCell = /<c r="B2"([^>]*)>/.exec(locations)![1];
    expect(nameCell).toContain('t="s"');
    expect(locations).toMatch(/<c r="E2"[^>]*><v>-100.25<\/v><\/c>/);
  });

  it('in the Camtrap DP files too, keeping every reference between them', () => {
    const files = packageOf(m, loaded, latlon2);
    const [dep] = parseDeploymentsNullable(files['deployments.csv']);
    expect([dep.locationId, dep.locationName, dep.longitude]).toEqual(['-12', "'=1+1", -100.25]);
    const [photo] = parseMedia(files['media.csv']);
    expect([photo.fileName, photo.comments, photo.deploymentId]).toEqual(["'@a.jpg", "'+cmd", dep.deploymentId]);
    const [obs] = parseObservations(files['observations.csv']);
    expect([obs.mediaId, obs.deploymentId]).toEqual([photo.mediaId, dep.deploymentId]);
  });
});

describe("the Photos view's tag switch", () => {
  it('keeps its photos and their detections, and leaves camera effort as it is', () => {
    const all = filter(model);
    const tagged = resultForTag(model, all, 'tagged');
    expect(column(photosTable(model, tagged, opts()), 'File name')).toEqual(['a.jpg', 'd.jpg']);
    expect(detectionsTable(model, tagged, opts()).rows).toHaveLength(3);
    expect(tagged.effort).toBe(all.effort);
    const untagged = resultForTag(model, all, 'untagged');
    expect(column(photosTable(model, untagged, opts()), 'File name')).toEqual(['b.jpg', 'c.jpg']);
    expect(detectionsTable(model, untagged, opts()).rows).toEqual([]);
    expect(resultForTag(model, all, 'all')).toBe(all);
  });

  it('counts only those photos in the summary', () => {
    const t = Object.fromEntries(summaryTable(model, resultForTag(model, filter(model), 'tagged'), opts(), facts).rows);
    expect([t.Photos, t['Tagged photos'], t['Untagged photos'], t.Detections]).toEqual([2, 2, 0, 3]);
  });

  it('limits the Camtrap DP package to their media, observations and deployments', () => {
    const tagged = packageOf(model, one, latlon2, resultForTag(model, filter(model), 'tagged'));
    expect(parseMedia(tagged['media.csv']).map((x) => x.fileName)).toEqual(['a.jpg', 'd.jpg']);
    expect(parseObservations(tagged['observations.csv'])).toHaveLength(3);
    expect(parseDeploymentsNullable(tagged['deployments.csv']).map((d) => d.locationId)).toEqual(['AA01', 'AA10']);
    const untagged = packageOf(model, one, latlon2, resultForTag(model, filter(model), 'untagged'));
    expect(parseMedia(untagged['media.csv']).map((x) => x.fileName)).toEqual(['b.jpg', 'c.jpg']);
    expect(parseObservations(untagged['observations.csv']).map((o) => o.observationType)).toEqual(['blank']);
    expect(parseDeploymentsNullable(untagged['deployments.csv']).map((d) => d.locationId)).toEqual(['AA01', '0000']);
  });
});

describe("downloads follow each table's sort", () => {
  const sorted = (sorting: Parameters<typeof tableOrder>[1]) =>
    opts({ order: tableOrder({ model, display: opts(), totalDetections: 3 }, sorting, false) });
  const byDefault = { locations: [{ id: 'id', desc: false }], species: [{ id: 'dets', desc: true }], photos: [{ id: 'time', desc: true }] };

  it('lists locations, species and photos as the tables do', () => {
    const o = sorted({ ...byDefault, locations: [{ id: 'photos', desc: true }], species: [{ id: 'common', desc: true }] });
    expect(column(locationsTable(model, filter(model), o), 'Location ID')).toEqual(['AA01', '0000', 'AA10']);
    expect(column(speciesTable(model, filter(model), o), 'Common name')).toEqual(['Coyote', 'Bobcat']);
    // Newest first, as the Photos list opens.
    expect(column(photosTable(model, filter(model), o), 'File name')).toEqual(['d.jpg', 'c.jpg', 'b.jpg', 'a.jpg']);
    const csv = csvFiles(model, filter(model), o);
    expect(csv['photos.csv'].split('\r\n').slice(1, 5).map((l) => l.split(',')[1])).toEqual(['d.jpg', 'c.jpg', 'b.jpg', 'a.jpg']);
  });

  it("keeps each photo's detections together, in the Photos order", () => {
    const o = sorted(byDefault);
    expect(column(detectionsTable(model, filter(model), o), 'File name')).toEqual(['d.jpg', 'a.jpg', 'a.jpg']);
    expect(column(detectionsTable(model, filter(model), opts()), 'File name')).toEqual(['a.jpg', 'a.jpg', 'd.jpg']);
  });

  it('carries the order into the workbook', () => {
    const tables = spreadsheetTables(model, filter(model), sorted({ ...byDefault, photos: [{ id: 'time', desc: false }] }), facts);
    expect(column(tables[3], 'File name')).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
  });
});

describe('a camera that moved under one deployment ID', () => {
  const loaded = [
    collection('Moved', 'mmm')
      .upload('u1', {
        deployments: [deployment('MV01', 'Moved', 12.5, -100.5, 1000)],
        media: [media('u1', 'm1.jpg', 'MV01', '2023-01-01T10:00:00')],
        observations: [observation('u1', 'm1.jpg', 'MV01', '', { common: 'Bobcat', scientific: 'Lynx rufus' })],
      })
      .upload('u2', {
        deployments: [deployment('MV01', 'Moved', 12.7, -100.7, 1000)],
        media: [media('u2', 'm2.jpg', 'MV01', '2023-06-01T10:00:00')],
        observations: [observation('u2', 'm2.jpg', 'MV01', '', { common: 'Coyote', scientific: 'Canis latrans' })],
      })
      .upload('u3', {
        deployments: [deployment('MV01', 'Moved', 12.5, -100.5, 1000)],
        media: [media('u3', 'm3.jpg', 'MV01', '2024-01-01T10:00:00')],
      })
      .build(),
  ];
  const m = buildModel(loaded);

  it('keeps each position as its own deployment, and each photo at its own', () => {
    const files = packageOf(m, loaded, latlon2);
    expect(parseDeploymentsNullable(files['deployments.csv']).map((d) => [d.deploymentId, d.latitude, d.longitude])).toEqual([
      ['test:MV01', 12.5, -100.5],
      ['test:MV01#2', 12.7, -100.7],
    ]);
    expect(parseMedia(files['media.csv']).map((x) => [x.fileName, x.deploymentId])).toEqual([
      ['m1.jpg', 'test:MV01'],
      ['m2.jpg', 'test:MV01#2'],
      ['m3.jpg', 'test:MV01'],
    ]);
    expect(parseObservations(files['observations.csv']).map((o) => [o.scientificName, o.deploymentId])).toEqual([
      ['Lynx rufus', 'test:MV01'],
      ['Canis latrans', 'test:MV01#2'],
    ]);
  });

  it('stays one deployment when the move is finer than the precision shown', () => {
    const coarse: Display = { ...latlon2, precision: { method: 'round', digits: 0 } };
    const files = packageOf(m, loaded, coarse);
    expect(parseDeploymentsNullable(files['deployments.csv']).map((d) => d.deploymentId)).toEqual(['test:MV01']);
    expect(new Set(parseMedia(files['media.csv']).map((x) => x.deploymentId))).toEqual(new Set(['test:MV01']));
  });
});
