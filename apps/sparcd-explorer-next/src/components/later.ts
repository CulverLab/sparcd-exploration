// Parts of the workspace nobody needs on first paint: the Charts view, the
// photo panel and the report with its downloads. They load as separate files
// once the workspace has drawn, so the first load stays small and nothing
// waits when they are opened.

import { lazy } from 'react';

const charts = () => import('./Charts');
const photoDetail = () => import('./PhotoDetail');
const report = () => import('./Report');

export const Charts = lazy(() => charts().then((m) => ({ default: m.Charts })));
export const PhotoDetail = lazy(() => photoDetail().then((m) => ({ default: m.PhotoDetail })));
export const ReportSheet = lazy(() => report().then((m) => ({ default: m.ReportSheet })));

/** Fetch them while the browser is idle after the workspace shows. */
export function preloadLater(): () => void {
  const load = () => void Promise.all([charts(), photoDetail(), report()]).catch(() => {});
  if ('requestIdleCallback' in window) {
    const id = requestIdleCallback(load, { timeout: 3000 });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(load, 1500);
  return () => clearTimeout(id);
}
