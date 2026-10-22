// The Activity column: camera effort per month for each location, on the
// month axis the effort strip uses too.

import { locationKeyOf, type Model } from '@/data';
import { countByMonth, type MonthCounts } from './months';

/**
 * Per location key, per month: [photos, untagged, matching], as `countByMonth`
 * counts them. `max` is the busiest month of any row.
 */
export function activityByLocation(model: Model, effort: number[], separate: boolean, match: number[] = []) {
  const split = (photos: number[]) => {
    const byKey = new Map<string, number[]>();
    for (const i of photos) {
      const key = locationKeyOf(model.sites[model.photos[i].site], separate);
      let list = byKey.get(key);
      if (!list) byKey.set(key, (list = []));
      list.push(i);
    }
    return byKey;
  };
  const matching = split(match);
  const byKey = new Map<string, MonthCounts>();
  let max = 1;
  for (const [key, photos] of split(effort)) {
    const months = countByMonth(model, photos, matching.get(key));
    byKey.set(key, months);
    for (const [n] of months.values()) max = Math.max(max, n);
  }
  return { byKey, max };
}
