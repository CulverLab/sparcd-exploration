import { useSyncExternalStore } from 'react';

const queries = new Map<string, MediaQueryList>();
const list = (query: string) => {
  let q = queries.get(query);
  if (!q) queries.set(query, (q = matchMedia(query)));
  return q;
};

/** Whether a media query matches now, following it as the window changes. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (change) => {
      const q = list(query);
      q.addEventListener('change', change);
      return () => q.removeEventListener('change', change);
    },
    () => list(query).matches,
  );
}

/** Under 760 px: the Filters sheet in place of the sidebar. */
export const PHONE = '(max-width: 759px)';
/** Under 1024 px: the top bar's actions move to a row above the figures. */
export const NARROW = '(max-width: 1023px)';
