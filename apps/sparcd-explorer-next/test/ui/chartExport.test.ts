import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DRAWING_WIDTH, IMAGE_WIDTH, LIGHT, hourCsv, imageLayout, monthCsv, speciesCsv, wrapText } from '../../src/lib/chartExport';
import { csvFileName } from '../../src/lib/csv';

const rowsOf = (csv: string) => csv.trimEnd().split('\r\n');

describe('Save data', () => {
  it('lists the species shown, a name a spreadsheet would run as a formula as text', () => {
    expect(
      rowsOf(
        speciesCsv([
          { key: 'Lynx rufus', name: 'Bobcat', scientificName: 'Lynx rufus', n: 4 },
          { key: 'x', name: '=Thing, odd', scientificName: '', n: 1 },
        ]),
      ),
    ).toEqual(['Species,Scientific name,Detections', 'Bobcat,Lynx rufus,4', `"'=Thing, odd",,1`]);
  });

  it('lists all 24 hours', () => {
    const rows = rowsOf(hourCsv(Array.from({ length: 24 }, (_, h) => (h === 5 ? 3 : 0))));
    expect(rows).toHaveLength(25);
    expect(rows.slice(0, 2)).toEqual(['Hour,Detections', '00:00,0']);
    expect(rows[6]).toBe('05:00,3');
    expect(rows[24]).toBe('23:00,0');
  });

  it('lists every month on the axis, across a new year', () => {
    expect(rowsOf(monthCsv([2, 0, 5], { first: 2023 * 12 + 10, count: 3 }))).toEqual(['Month,Detections', '2023-11,2', '2023-12,0', '2024-01,5']);
  });

  it('names its files as the other downloads', () => {
    const today = new Date(2026, 10, 4);
    expect(csvFileName(['Alpha Basin'], 'hour-chart', today)).toBe('alpha-basin-2026-11-04-hour-chart.csv');
    expect(csvFileName(['Alpha Basin', 'Bravo'], 'species-chart', today, 'png')).toBe('alpha-basin-and-bravo-2026-11-04-species-chart.png');
  });
});

describe('Save image', () => {
  // Every character 10 px wide, so a line's width is plain to read.
  const width = (s: string) => s.length * 10;

  it('wraps long text at spaces', () => {
    expect(wrapText('one two three four', 90, width)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('  one   two ', 300, width)).toEqual(['one two']);
    expect(wrapText('', 300, width)).toEqual([]);
  });

  it('breaks a word too long for a line rather than clip it', () => {
    const lines = wrapText(`short ${'x'.repeat(25)} end`, 100, width);
    expect(lines).toEqual(['short', 'xxxxxxxxxx', 'xxxxxxxxxx', 'xxxxx end']);
    expect(lines.every((l) => width(l) <= 100)).toBe(true);
  });

  const words = { title: 'Detections by species', subtitle: 'Common names', footer: 'Alpha · No filters: all photos · Saved 2026-11-04' };

  it('lays out the title, the subtitle, the chart, then the footer, top to bottom', () => {
    const { lines, chartY, height } = imageLayout(words, 200, width);
    expect(lines.map((l) => l.kind)).toEqual(['title', 'subtitle', 'foot']);
    expect(lines[0].y).toBeLessThan(lines[1].y);
    expect(lines[1].y).toBeLessThan(chartY);
    expect(lines[2].y).toBeGreaterThan(chartY + 200);
    expect(height).toBeGreaterThan(lines[2].y);
  });

  it('wraps a long footer, and the picture grows to hold it', () => {
    const short = imageLayout(words, 200, width);
    const footer = Array.from({ length: 60 }, (_, i) => `Collection ${i}`).join(', ');
    const long = imageLayout({ ...words, footer }, 200, width);
    const feet = long.lines.filter((l) => l.kind === 'foot');
    expect(feet.length).toBeGreaterThan(3);
    expect(feet.every((l) => width(l.text) <= DRAWING_WIDTH)).toBe(true);
    expect(feet.map((l) => l.text).join(' ')).toBe(footer);
    expect(long.height).toBe(short.height + (feet.length - 1) * 16);
    expect(feet[feet.length - 1].y).toBeLessThan(long.height);
    expect(long.chartY).toBe(short.chartY);
  });

  it('keeps the drawing inside the fixed width', () => {
    expect(IMAGE_WIDTH).toBe(1000);
    expect(DRAWING_WIDTH).toBeLessThan(IMAGE_WIDTH);
  });

  it('mirrors the light theme’s chart colours', () => {
    const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8');
    const light = css.slice(css.indexOf(':root {'), css.indexOf('.dark {'));
    for (const [token, colour] of Object.entries(LIGHT)) expect(light, token).toContain(`--${token}: ${colour};`);
  });
});
