// Number, date and coordinate text as the tables, summary and exports show it.
// Coordinates always pass through the display precision first.

import {
  elevationIn,
  formatDegrees,
  formatUtm,
  type ElevationUnit,
  type Position,
  type Precision,
} from '@/data';

export type Display = { coords: 'latlon' | 'utm'; precision: Precision; elevation: ElevationUnit };

export const fmtN = (n: number): string => Math.round(n).toLocaleString('en-US');

export const plural = (n: number, one: string, many = `${one}s`): string => `${fmtN(n)} ${n === 1 ? one : many}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2023-09-14` → `Sep 2023`. */
export const monthName = (date: string): string => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

export function formatElevation(metres: number | null, unit: ElevationUnit): string {
  return metres === null ? '—' : `${fmtN(elevationIn(metres, unit))} ${unit}`;
}

/** One position as a single cell: `12.500, -100.250` or `12N 500000 3468600`. */
export function formatPosition(pos: Position | null, d: Display): string {
  if (!pos) return '—';
  if (d.coords === 'utm') {
    const u = formatUtm(pos, d.precision);
    return `${u.zone} ${u.easting} ${u.northing}`;
  }
  return `${formatDegrees(pos.lat, d.precision)}, ${formatDegrees(pos.lon, d.precision)}`;
}

/** The two letters on the account button. */
export const initials = (name: string): string => name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';
