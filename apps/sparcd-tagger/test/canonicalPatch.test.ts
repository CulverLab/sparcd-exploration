import { describe, expect, it } from 'vitest';
import { MEDIA_COL, OBS_COL, parseCsvRows, serializeCsvRows } from '@sparcd/camtrap';
import { applyCanonicalPatches, locationPatches, patchesMatch, reapplyLocationPatches, reversePatches } from '../src/lib/canonicalPatch';
import type { CanonicalState } from '../src/lib/sync';

function state(deployment = 'old'): CanonicalState {
  const media = Array.from({ length: MEDIA_COL.comments + 2 }, () => '');
  media[MEDIA_COL.mediaId] = 'image'; media[MEDIA_COL.deploymentId] = deployment; media[MEDIA_COL.timestamp] = '2024-01-01T08:00:00';
  media[MEDIA_COL.comments] = '[NEED_EXPERT:true]'; media[media.length - 1] = 'unmodeled media';
  const obs = Array.from({ length: OBS_COL.comments + 2 }, () => '');
  obs[OBS_COL.observationId] = 'observation'; obs[OBS_COL.mediaId] = 'image'; obs[OBS_COL.deploymentId] = deployment; obs[OBS_COL.timestamp] = media[MEDIA_COL.timestamp];
  obs[OBS_COL.scientificName] = 'Lynx rufus'; obs[obs.length - 1] = 'unmodeled observation';
  const file = (text: string) => ({ text, etag: text, hash: text });
  return { media: file(serializeCsvRows([media])), observations: file(serializeCsvRows([obs])), deployments: file(serializeCsvRows([[deployment, 'metadata']])), uploadMeta: file('{}') };
}
function apply(current: CanonicalState, patches: Parameters<typeof applyCanonicalPatches>[1]) {
  const next = structuredClone(current);
  for (const [role, text] of Object.entries(applyCanonicalPatches(current, patches))) next[role as 'media'].text = text;
  return next;
}
describe('targeted location reversal', () => {
  it('reverses only deployment/time cells and preserves new species, audit and unknown columns', () => {
    const original = state(), changed = state('new');
    const patches = locationPatches(original, changed), later = structuredClone(changed);
    const rows = parseCsvRows(later.observations.text); rows[0][OBS_COL.scientificName] = 'Puma concolor';
    rows[0][OBS_COL.comments] = '[REVIEWED_BY:Bob][REVIEWED_AT:2026-01-01]'; later.observations.text = serializeCsvRows(rows);
    expect(patchesMatch(patches, later)).toBe(true);
    const result = apply(later, reversePatches(patches));
    const observation = parseCsvRows(result.observations.text)[0];
    expect(observation[OBS_COL.deploymentId]).toBe('old'); expect(observation[OBS_COL.scientificName]).toBe('Puma concolor');
    expect(observation[OBS_COL.comments]).toContain('Bob'); expect(observation.at(-1)).toBe('unmodeled observation');
    expect(result.media.text).toBe(original.media.text);
  });
  it('refuses a changed affected cell and a deployment now used by an unrelated row', () => {
    const original = state(), changed = state('new'), patches = locationPatches(original, changed);
    const rows = parseCsvRows(changed.media.text); rows.push([...rows[0]]); rows[1][MEDIA_COL.mediaId] = 'later-image'; changed.media.text = serializeCsvRows(rows);
    expect(patchesMatch(patches, changed)).toBe(false);
    rows.pop(); rows[0][MEDIA_COL.timestamp] = 'later timestamp'; changed.media.text = serializeCsvRows(rows);
    // Timestamp was not changed by this action, so a later unrelated change survives.
    expect(patchesMatch(patches, changed)).toBe(true);
    rows[0][MEDIA_COL.deploymentId] = 'other'; changed.media.text = serializeCsvRows(rows);
    expect(patchesMatch(patches, changed)).toBe(false); expect(() => apply(changed, reversePatches(patches))).toThrow('affected location value changed');
  });
  it('retargets explicit reapplication while retaining newly introduced rows', () => {
    const original = state(), desired = state('new'), current = state('remote');
    const extra = parseCsvRows(current.media.text); extra.push([...extra[0]]); extra[1][MEDIA_COL.mediaId] = 'later-image'; current.media.text = serializeCsvRows(extra);
    const result = apply(current, reapplyLocationPatches(locationPatches(original, desired), current));
    expect(parseCsvRows(result.media.text).map(row => row[MEDIA_COL.deploymentId])).toEqual(['new', 'remote']);
    expect(parseCsvRows(result.deployments.text).map(row => row[0]).sort()).toEqual(['new', 'remote']);
  });
  it('restores an absent original deployment as an empty file and detects changed registry metadata', () => {
    const original = state(); original.deployments.text = '';
    const desired = state('new'), patches = locationPatches(original, desired);
    expect(apply(desired, reversePatches(patches)).deployments.text).toBe('');
    const current = state('new'); current.deployments.text = serializeCsvRows([['new', 'changed metadata']]);
    expect(() => reapplyLocationPatches(patches, current)).toThrow('deployment was changed elsewhere');
  });
});
