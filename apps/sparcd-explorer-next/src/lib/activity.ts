// The Activity column: photos per month for each location, on one month axis
// shared by every row and the header.

import { locationKeyOf, type Model } from '@/data';

/** Months as `year * 12 + month - 1`. */
export type MonthAxis = { first: number; count: number };

const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;

export function monthAxis(model: Model): MonthAxis | null {
  if (!model.dateSpan) return null;
  const first = monthIndex(model.dateSpan.first);
  return { first, count: monthIndex(model.dateSpan.last) - first + 1 };
}

/** Per location key, per month: [photos, untagged]. `max` is the busiest month of any row. */
export function activityByLocation(model: Model, photos: number[], separate: boolean) {
  const byKey = new Map<string, Map<number, [number, number]>>();
  let max = 1;
  for (const i of photos) {
    const p = model.photos[i];
    if (p.date === null) continue;
    const key = locationKeyOf(model.sites[p.site], separate);
    let months = byKey.get(key);
    if (!months) byKey.set(key, (months = new Map()));
    const m = (p.year! * 12 + p.month! - 1);
    const cell = months.get(m) ?? [0, 0];
    cell[0]++;
    if (!p.tagged) cell[1]++;
    months.set(m, cell);
    max = Math.max(max, cell[0]);
  }
  return { byKey, max };
}
