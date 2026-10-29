import { MEDIA_COL, OBS_COL, parseCsvRows, serializeCsvRows } from '@sparcd/camtrap';
import type { CanonicalState } from './sync';

export type CanonicalPatch = {
  role: 'media' | 'observations' | 'deployments';
  row: string;
  column?: number;
  before: string | string[] | null;
  after: string | string[] | null;
  index: number;
};
const idColumn = (role: CanonicalPatch['role']) => role === 'media' ? MEDIA_COL.mediaId : role === 'observations' ? OBS_COL.observationId : 0;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Location reversal changes only its affected deployment rows and the
 * deployment/time cells it changed; species, audit data and other rows survive. */
export function locationPatches(before: CanonicalState, after: CanonicalState): CanonicalPatch[] {
  const patches: CanonicalPatch[] = [];
  for (const role of ['media', 'observations', 'deployments'] as const) {
    const a = parseCsvRows(before[role].text), b = parseCsvRows(after[role].text), id = idColumn(role);
    const columns = role === 'media' ? [MEDIA_COL.deploymentId, MEDIA_COL.timestamp] : [OBS_COL.deploymentId, OBS_COL.timestamp];
    for (const key of new Set([...a, ...b].map(row => row[id]))) {
      const previous = a.find(row => row[id] === key), next = b.find(row => row[id] === key);
      const index = previous ? a.indexOf(previous) : b.indexOf(next!);
      if (role === 'deployments') {
        if (!same(previous ?? null, next ?? null)) patches.push({ role, row: key, before: previous ?? null, after: next ?? null, index });
      } else if (previous && next) {
        for (const column of columns) if (previous[column] !== next[column]) patches.push({ role, row: key, column, before: previous[column] ?? '', after: next[column] ?? '', index });
      }
    }
  }
  return patches;
}
export function patchesMatch(patches: CanonicalPatch[], current: CanonicalState): boolean {
  const matches = patches.every(patch => {
    const row = parseCsvRows(current[patch.role].text).find(row => row[idColumn(patch.role)] === patch.row);
    return same(patch.column === undefined ? row ?? null : row?.[patch.column] ?? null, patch.after);
  });
  if (!matches) return false;
  // Do not remove a deployment that a later, unrelated row now references.
  for (const patch of patches.filter(p => p.role === 'deployments' && p.before === null)) {
    for (const role of ['media', 'observations'] as const) {
      const column = role === 'media' ? MEDIA_COL.deploymentId : OBS_COL.deploymentId;
      if (parseCsvRows(current[role].text).some(row => row[column] === patch.row && !patches.some(p => p.role === role && p.row === row[idColumn(role)]))) return false;
    }
  }
  return true;
}
export function applyCanonicalPatches(current: CanonicalState, patches: CanonicalPatch[]): Partial<Record<CanonicalPatch['role'], string>> {
  const out: Partial<Record<CanonicalPatch['role'], string>> = {};
  for (const role of ['media', 'observations', 'deployments'] as const) {
    const relevant = patches.filter(p => p.role === role);
    if (!relevant.length) continue;
    const rows = parseCsvRows(current[role].text), id = idColumn(role);
    for (const patch of relevant) {
      const index = rows.findIndex(row => row[id] === patch.row), row = rows[index];
      const value = patch.column === undefined ? row ?? null : row?.[patch.column] ?? null;
      if (!same(value, patch.before)) throw new Error('An affected location value changed before the reversal. Review the current stored data.');
      if (patch.column !== undefined) row[patch.column] = patch.after as string;
      else if (index >= 0) {
        if (patch.after) rows[index] = patch.after as string[]; else rows.splice(index, 1);
      } else if (patch.after) rows.splice(Math.min(patch.index, rows.length), 0, patch.after as string[]);
    }
    out[role] = serializeCsvRows(rows);
  }
  return out;
}
export const reversePatches = (patches: CanonicalPatch[]) => patches.map(p => ({ ...p, before: p.after, after: p.before }));

/** Reapplication is an explicit user choice. Freeze the original row targets,
 * preserve newly added rows, and ground the chosen values on current storage. */
export function reapplyLocationPatches(patches: CanonicalPatch[], current: CanonicalState): CanonicalPatch[] {
  const out: CanonicalPatch[] = [];
  for (const patch of patches) {
    const row = parseCsvRows(current[patch.role].text).find(row => row[idColumn(patch.role)] === patch.row);
    const before = patch.column === undefined ? row ?? null : row?.[patch.column] ?? null;
    if (patch.column !== undefined && !row) throw new Error('An originally affected row was removed. Keep current storage or revise the pending action.');
    if (patch.role === 'deployments' && patch.before === null && row && !same(row, patch.after)) throw new Error('The chosen deployment was changed elsewhere. Keep current storage or choose its new version explicitly.');
    if (patch.role === 'deployments' && patch.after === null) {
      const unrelated = (['media', 'observations'] as const).some(role => parseCsvRows(current[role].text).some(row =>
        row[role === 'media' ? MEDIA_COL.deploymentId : OBS_COL.deploymentId] === patch.row && !patches.some(p => p.role === role && p.row === row[idColumn(role)])));
      if (unrelated) continue;
    }
    if (!same(before, patch.after)) out.push({ ...patch, before });
  }
  return out;
}
