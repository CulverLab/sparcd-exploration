// The table as clicked and as shown. The view switch, the layout, the sort
// and the filters change at once where they were clicked; the table, the
// heavy part with hundreds of thousands of photos, follows in a background
// render, so the click paints first.

import { useDeferredValue, useMemo } from 'react';
import { useStore } from '@/store';
import { useView } from './useView';

export function useTableView() {
  const filtered = useView();
  const view = useStore((s) => s.view);
  const layout = useStore((s) => s.photoLayout);
  const sorting = useStore((s) => s.sorting);
  const now = useMemo(() => ({ ...filtered, view, layout, sorting }), [filtered, view, layout, sorting]);
  const shown = useDeferredValue(now);
  return { now, shown, updating: shown !== now };
}
