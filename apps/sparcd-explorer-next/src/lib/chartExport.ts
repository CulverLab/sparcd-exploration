// A chart as a file, from the same filtered numbers the chart draws: its rows
// as a CSV, or its drawing as a PNG to paste into a report. The picture is
// always the same: 1000 CSS px wide at 2x, on white in the light palette, in
// system fonts, so it depends on neither the window nor the page's CSS.

import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { toCsv } from './csv';
import { monthKey, type MonthAxis } from './months';
import type { Cell, Col } from './tables';

// --- Save data -------------------------------------------------------------------

const column = <R,>(label: string, value: (r: R) => Cell, numeric = false): Col<R> => ({ id: label, label, def: true, numeric, value });

export type SpeciesBar = { key: string; name: string; scientificName: string; n: number };

export const speciesCsv = (rows: SpeciesBar[]): string =>
  toCsv(
    [
      column<SpeciesBar>('Species', (r) => r.name),
      column<SpeciesBar>('Scientific name', (r) => r.scientificName || null),
      column<SpeciesBar>('Detections', (r) => r.n, true),
    ],
    rows,
  );

type Bin = { at: string; n: number };
const binsCsv = (label: string, bins: Bin[]) => toCsv([column<Bin>(label, (r) => r.at), column<Bin>('Detections', (r) => r.n, true)], bins);

export const hourCsv = (hours: number[]): string =>
  binsCsv('Hour', hours.map((n, hour) => ({ at: `${String(hour).padStart(2, '0')}:00`, n })));

export const monthCsv = (months: number[], axis: MonthAxis): string =>
  binsCsv('Month', months.map((n, i) => ({ at: monthKey(axis.first + i), n })));

// --- Save image: the layout ----------------------------------------------------------

export const IMAGE_WIDTH = 1000;
const IMAGE_SCALE = 2;
const PAD = 32;
/** The width a chart's drawing gets in the picture. */
export const DRAWING_WIDTH = IMAGE_WIDTH - 2 * PAD;

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** The light theme's chart colours, as `:root` in index.css sets them. */
export const LIGHT = { ink: '#1c1a14', inkSoft: '#4a463b', inkMute: '#6b6555', rule: '#8c8166', ruleSoft: '#cfc4a8', accent: '#0b3358' };

type LineKind = 'title' | 'subtitle' | 'foot';

const FONTS: Record<LineKind, string> = { title: `600 22px ${SANS}`, subtitle: `400 14px ${SANS}`, foot: `400 12px ${SANS}` };
const LINE_HEIGHTS: Record<LineKind, number> = { title: 28, subtitle: 20, foot: 16 };
const LABEL_FONT = `400 12.5px ${SANS}`;

const IMAGE_STYLE = `
svg { overflow: visible; }
text { font: ${LABEL_FONT}; fill: ${LIGHT.inkSoft}; }
text.mono { font: 400 12px ${MONO}; fill: ${LIGHT.inkMute}; }
text.yearlab { font: 500 12.5px ${MONO}; fill: ${LIGHT.ink}; }
text.title { font: ${FONTS.title}; fill: ${LIGHT.ink}; }
text.subtitle { font: ${FONTS.subtitle}; fill: ${LIGHT.inkMute}; }
text.foot { font: ${FONTS.foot}; fill: ${LIGHT.inkMute}; }
.grid { stroke: ${LIGHT.ruleSoft}; stroke-width: 1; }
.axis { stroke: ${LIGHT.rule}; stroke-width: 1; }
.night { fill: ${LIGHT.ruleSoft}; opacity: 0.55; }
.bar { fill: ${LIGHT.accent}; }
.hit { fill: transparent; }
`;

/** `text` broken into lines no wider than `max`, at spaces, and inside a word only one too long for a line. */
export function wrapText(text: string, max: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const longer = line ? `${line} ${word}` : word;
    if (width(longer) <= max) {
      line = longer;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    while (width(line) > max) {
      let fit = line.length - 1;
      while (fit > 1 && width(line.slice(0, fit)) > max) fit--;
      lines.push(line.slice(0, fit));
      line = line.slice(fit);
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type ImageWords = { title: string; subtitle: string; footer: string };
export type ImageLine = { text: string; kind: LineKind; y: number };

/** Top to bottom: the title, its subtitle, the chart, then the footer, each wrapped to fit. */
export function imageLayout(words: ImageWords, chartHeight: number, width: (s: string, kind: LineKind) => number) {
  const lines: ImageLine[] = [];
  let y = PAD;
  const block = (text: string, kind: LineKind) => {
    for (const line of wrapText(text, DRAWING_WIDTH, (s) => width(s, kind))) {
      y += LINE_HEIGHTS[kind];
      lines.push({ text: line, kind, y: y - LINE_HEIGHTS[kind] * 0.25 });
    }
  };
  block(words.title, 'title');
  block(words.subtitle, 'subtitle');
  y += 14;
  const chartY = y;
  y += chartHeight + 18;
  block(words.footer, 'foot');
  return { lines, chartY, height: Math.ceil(y + PAD) };
}

// --- Save image: the picture ---------------------------------------------------------

const measurer = () => document.createElement('canvas').getContext('2d')!;

/** Room for the longest species name in the picture, which has more of it than the page. */
export function imageLabelWidth(names: string[]): number {
  const ctx = measurer();
  ctx.font = LABEL_FONT;
  return Math.ceil(Math.min(DRAWING_WIDTH * 0.36, Math.max(150, ...names.map((n) => ctx.measureText(n).width + 12))));
}

const SVG = 'http://www.w3.org/2000/svg';

/** The drawing as a node of its own: no document, no page CSS, nothing left mounted. */
function drawn(drawing: ReactElement): SVGSVGElement {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(drawing));
  const svg = host.querySelector('svg')!.cloneNode(true) as SVGSVGElement;
  root.unmount();
  return svg;
}

/** The whole picture as SVG markup, and its size in pixels. */
function pictureOf(drawing: ReactElement, words: ImageWords): { markup: string; width: number; height: number } {
  const chart = drawn(drawing);
  const ctx = measurer();
  const { lines, chartY, height } = imageLayout(words, Number(chart.getAttribute('height')), (s, kind) => {
    ctx.font = FONTS[kind];
    return ctx.measureText(s).width;
  });
  const svg = document.createElementNS(SVG, 'svg');
  const set = (el: Element, attrs: Record<string, string | number>) => {
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  };
  set(svg, { width: IMAGE_WIDTH * IMAGE_SCALE, height: height * IMAGE_SCALE, viewBox: `0 0 ${IMAGE_WIDTH} ${height}` });
  const style = document.createElementNS(SVG, 'style');
  style.textContent = IMAGE_STYLE;
  svg.append(style, set(document.createElementNS(SVG, 'rect'), { width: IMAGE_WIDTH, height, fill: '#ffffff' }));
  for (const line of lines) {
    const text = set(document.createElementNS(SVG, 'text'), { class: line.kind, x: PAD, y: line.y });
    text.textContent = line.text;
    svg.append(text);
  }
  svg.append(set(chart, { x: PAD, y: chartY }));
  return { markup: new XMLSerializer().serializeToString(svg), width: IMAGE_WIDTH * IMAGE_SCALE, height: height * IMAGE_SCALE };
}

/** A chart's drawing, under its title and over its footer, as a PNG. */
export async function chartPng(drawing: ReactElement, words: ImageWords): Promise<Blob> {
  const { markup, width, height } = pictureOf(drawing, words);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = reject;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  canvas.getContext('2d')!.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No image'))), 'image/png'));
}
