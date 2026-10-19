// The Columns editor's state for one table view: column order and which are
// shown. Saved per view; a column added since the choice was saved joins at
// its default place and visibility.

import { readStored, writeStored } from './storage';

export type ColumnInfo = { id: string; def: boolean; multi?: boolean };
export type ColumnPrefs = { order: string[]; visible: string[] };

export const defaultPrefs = (defs: ColumnInfo[]): ColumnPrefs => ({
  order: defs.map((d) => d.id),
  visible: defs.filter((d) => d.def).map((d) => d.id),
});

export function mergePrefs(saved: ColumnPrefs | null, defs: ColumnInfo[]): ColumnPrefs {
  if (!saved) return defaultPrefs(defs);
  const known = new Set(defs.map((d) => d.id));
  const order = saved.order.filter((id) => known.has(id));
  const visible = new Set(saved.visible.filter((id) => known.has(id)));
  defs.forEach((d, i) => {
    if (order.includes(d.id)) return;
    order.splice(Math.min(i, order.length), 0, d.id);
    if (d.def) visible.add(d.id);
  });
  return { order, visible: order.filter((id) => visible.has(id)) };
}

export function toggleColumn(p: ColumnPrefs, id: string): ColumnPrefs {
  const on = new Set(p.visible);
  if (on.has(id)) on.delete(id);
  else on.add(id);
  return { order: p.order, visible: p.order.filter((c) => on.has(c)) };
}

/** Move a column one place among the listed ones (`listed` skips columns the editor hides). */
export function moveColumn(p: ColumnPrefs, id: string, step: -1 | 1, listed: (id: string) => boolean): ColumnPrefs {
  const order = [...p.order];
  const from = order.indexOf(id);
  let to = from + step;
  while (to >= 0 && to < order.length && !listed(order[to])) to += step;
  if (from < 0 || to < 0 || to >= order.length) return p;
  order.splice(from, 1);
  order.splice(to, 0, id);
  return { order, visible: order.filter((c) => p.visible.includes(c)) };
}

/** Columns this table shows, in order. Collection-only columns need several collections open. */
export function shownColumns(p: ColumnPrefs, defs: ColumnInfo[], multi: boolean): string[] {
  const byId = new Map(defs.map((d) => [d.id, d]));
  return p.order.filter((id) => p.visible.includes(id) && (multi || !byId.get(id)?.multi));
}

const key = (view: string) => `sparcd-explorer-columns:${view}`;

const isPrefs = (v: unknown): v is ColumnPrefs =>
  typeof v === 'object' &&
  v !== null &&
  Array.isArray((v as ColumnPrefs).order) &&
  Array.isArray((v as ColumnPrefs).visible) &&
  [...(v as ColumnPrefs).order, ...(v as ColumnPrefs).visible].every((id) => typeof id === 'string');

export const loadPrefs = (view: string, defs: ColumnInfo[]): ColumnPrefs =>
  mergePrefs(readStored<ColumnPrefs | null>(key(view), null, (v): v is ColumnPrefs | null => isPrefs(v)), defs);

/** `null` forgets the saved choice, so the defaults apply again. */
export const savePrefs = (view: string, p: ColumnPrefs | null): void => writeStored(key(view), p);
