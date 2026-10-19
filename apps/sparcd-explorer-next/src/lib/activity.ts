// The Activity column: photos per month for each location, on the month axis
// the effort strip uses too.

import { locationKeyOf, type Model } from '@/data';
import type { MonthCounts } from './months';

/** Per location key, per month: [photos, untagged]. `max` is the busiest month of any row. */
export function activityByLocation(model: Model, photos: number[], separate: boolean) {
  const byKey = new Map<string, MonthCounts>();
  let max = 1;
  for (const i of photos) {
    const p = model.photos[i];
    if (p.year === null) continue;
    const key = locationKeyOf(model.sites[p.site], separate);
    let months = byKey.get(key);
    if (!months) byKey.set(key, (months = new Map()));
    const m = p.year * 12 + p.month! - 1;
    const cell = months.get(m) ?? [0, 0];
    cell[0]++;
    if (!p.tagged) cell[1]++;
    months.set(m, cell);
    max = Math.max(max, cell[0]);
  }
  return { byKey, max };
}
