// The multi-species draft model: pure array transforms (add-only, ghost-
// exclusive, remove-one, per-species count) plus the store actions that seed a
// fresh draft from the FULL base set so editing one species preserves the rest.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  addObservation,
  incrementObservation,
  removeObservation,
  setObservationCount,
  blankDraft,
  useDraftStore,
  GHOST,
  type AppliedTag,
  type DraftObservation,
  type UploadCtx,
} from '../src/lib/drafts';

const obs = (scientificName: string, count = 1, commonName = ''): DraftObservation => ({
  scientificName,
  commonName,
  count,
  requestedSpecies: '',
  freeTags: '',
});

const tag = (scientificName: string, count = 1, commonName = ''): AppliedTag => ({
  scientificName,
  commonName,
  count,
});

describe('addObservation', () => {
  it('adds a species when absent, appended last', () => {
    const next = addObservation([obs('Canis latrans')], tag('Lynx rufus'));
    expect(next.map((o) => o.scientificName)).toEqual(['Canis latrans', 'Lynx rufus']);
  });

  it('is a NO-OP when the species is already present (no dup, no count change)', () => {
    const next = addObservation([obs('Canis latrans', 2)], tag('Canis latrans', 9));
    expect(next).toHaveLength(1);
    expect(next[0].count).toBe(2);
  });

  it('applying a real species clears Ghost', () => {
    const next = addObservation([obs(GHOST.label, 1, GHOST.commonName)], tag('Canis latrans'));
    expect(next.map((o) => o.scientificName)).toEqual(['Canis latrans']);
  });

  it('applying Ghost clears all real species', () => {
    const next = addObservation([obs('Canis latrans'), obs('Lynx rufus')], tag(GHOST.label, 1, GHOST.commonName));
    expect(next.map((o) => o.scientificName)).toEqual([GHOST.label]);
  });

  it('floors count to ≥1', () => {
    const next = addObservation([], tag('Canis latrans', 0));
    expect(next[0].count).toBe(1);
  });
});

describe('incrementObservation', () => {
  it('adds an absent species at one and preserves its metadata', () => {
    const next = incrementObservation([], {
      ...tag('Canis latrans', 9, 'Coyote'),
      requestedSpecies: 'Prairie wolf',
      freeTags: '[NOTE:blurred]',
    });
    expect(next).toEqual([
      expect.objectContaining({
        scientificName: 'Canis latrans',
        count: 1,
        requestedSpecies: 'Prairie wolf',
        freeTags: '[NOTE:blurred]',
      }),
    ]);
  });

  it('increments an existing species and preserves every other observation', () => {
    const next = incrementObservation(
      [obs('Odocoileus hemionus', 2, 'Mule Deer'), obs('Canis latrans', 4, 'Coyote')],
      tag('Odocoileus hemionus', 1, 'Mule Deer'),
    );
    expect(next.map((o) => [o.scientificName, o.count])).toEqual([
      ['Odocoileus hemionus', 3],
      ['Canis latrans', 4],
    ]);
  });

  it('clears Ghost when a real species is incremented', () => {
    expect(
      incrementObservation([obs(GHOST.label, 1, GHOST.commonName)], tag('Canis latrans')),
    ).toEqual([expect.objectContaining({ scientificName: 'Canis latrans', count: 1 })]);
  });

  it('keeps Ghost at exactly one and mutually exclusive when called defensively', () => {
    expect(
      incrementObservation([obs('Canis latrans', 3)], tag(GHOST.label, 9, GHOST.commonName)),
    ).toEqual([expect.objectContaining({ scientificName: GHOST.label, count: 1 })]);
  });
});

describe('removeObservation', () => {
  it('removes exactly one species, keeps the rest in order', () => {
    const next = removeObservation([obs('A'), obs('B'), obs('C')], 'B');
    expect(next.map((o) => o.scientificName)).toEqual(['A', 'C']);
  });
});

describe('setObservationCount', () => {
  it('sets one species count, floors to ≥1, leaves others', () => {
    const next = setObservationCount([obs('A', 1), obs('B', 1)], 'A', 5);
    expect(next.find((o) => o.scientificName === 'A')!.count).toBe(5);
    expect(next.find((o) => o.scientificName === 'B')!.count).toBe(1);
    expect(setObservationCount([obs('A', 1)], 'A', 0)[0].count).toBe(1);
  });
});

// --- Store actions ----------------------------------------------------------

const CTX: UploadCtx = { bucket: 'b', uploadPrefix: 'p/' };
const DEP = 'b:loc';
const PATH = 'p/IMG001.JPG';
const BASE = { observations: [obs('Odocoileus hemionus', 1, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')] };

function target(base = BASE) {
  return { mediaPath: PATH, deploymentId: DEP, base };
}

describe('draft store — add-only over a base multi-species image', () => {
  beforeEach(() => {
    useDraftStore.setState({ drafts: {}, loadedKey: null, loading: false, timeOffset: null });
  });

  it('addSpecies on a base multi-species image preserves every existing species', () => {
    useDraftStore.getState().addSpecies(CTX, [target()], tag('Lynx rufus', 1, 'Bobcat'));
    const d = useDraftStore.getState().drafts[PATH];
    expect(d.observations.map((o) => o.scientificName)).toEqual([
      'Odocoileus hemionus',
      'Canis latrans',
      'Lynx rufus',
    ]);
    expect(d.dirty).toBe(true);
  });

  it('addSpecies of an already-present species is a NO-OP (still seeded from base)', () => {
    useDraftStore.getState().addSpecies(CTX, [target()], tag('Canis latrans', 9, 'Coyote'));
    const d = useDraftStore.getState().drafts[PATH];
    expect(d.observations).toHaveLength(2);
    expect(d.observations.find((o) => o.scientificName === 'Canis latrans')!.count).toBe(1);
  });

  it('removeSpecies removes one and keeps the others', () => {
    useDraftStore.getState().removeSpecies(CTX, PATH, DEP, BASE, 'Canis latrans');
    expect(useDraftStore.getState().drafts[PATH].observations.map((o) => o.scientificName)).toEqual([
      'Odocoileus hemionus',
    ]);
  });

  it('setSpeciesCount sets one species count on an image seeded from base', () => {
    useDraftStore.getState().setSpeciesCount(CTX, PATH, DEP, BASE, 'Odocoileus hemionus', 4);
    const d = useDraftStore.getState().drafts[PATH];
    expect(d.observations.find((o) => o.scientificName === 'Odocoileus hemionus')!.count).toBe(4);
    expect(d.observations.find((o) => o.scientificName === 'Canis latrans')!.count).toBe(1);
  });

  it('setTimeOverride on a fresh draft preserves the full base species set', () => {
    useDraftStore.getState().setTimeOverride(CTX, PATH, DEP, BASE, '2024-01-10T09:00:00');
    const d = useDraftStore.getState().drafts[PATH];
    expect(d.timeOverride).toBe('2024-01-10T09:00:00');
    expect(d.observations.map((o) => o.scientificName)).toEqual([
      'Odocoileus hemionus',
      'Canis latrans',
    ]);
    expect(d.dirty).toBe(true);
  });

  it('applies a composed offset to exactly one target and preserves its base species', () => {
    useDraftStore.getState().applyTimeOffsetToSelection(
      CTX,
      [{ ...target(), currentCorrected: '2024-01-10T10:00:00.000Z' }],
      { years: 0, months: 0, days: 0, hours: 1, minutes: 15, seconds: 0 },
    );
    const drafts = useDraftStore.getState().drafts;
    expect(Object.keys(drafts)).toEqual([PATH]);
    expect(drafts[PATH].timeOverride).toBe('2024-01-10T11:15:00.000+00:00');
    expect(drafts[PATH].observations.map((o) => o.scientificName)).toEqual([
      'Odocoileus hemionus',
      'Canis latrans',
    ]);
  });

  it('detag clears all observations', () => {
    useDraftStore.getState().detag(CTX, [target()]);
    expect(useDraftStore.getState().drafts[PATH].observations).toEqual([]);
  });

  it('addSpecies over a selection adds to every target (add-only, no toggle)', () => {
    const P2 = 'p/IMG002.JPG';
    const targets = [target(), { mediaPath: P2, deploymentId: DEP, base: { observations: [] } }];
    useDraftStore.getState().addSpecies(CTX, targets, tag('Lynx rufus', 1, 'Bobcat'));
    const d = useDraftStore.getState().drafts;
    expect(d[PATH].observations.map((o) => o.scientificName)).toContain('Lynx rufus');
    expect(d[P2].observations.map((o) => o.scientificName)).toEqual(['Lynx rufus']);
  });

  it('incrementSpecies increments each selection target from its own current count', () => {
    const P2 = 'p/IMG002.JPG';
    const targets = [
      target({ observations: [obs('Odocoileus hemionus', 2, 'Mule Deer')] }),
      { mediaPath: P2, deploymentId: DEP, base: { observations: [] } },
    ];
    useDraftStore.getState().incrementSpecies(
      CTX,
      targets,
      tag('Odocoileus hemionus', 1, 'Mule Deer'),
    );
    const d = useDraftStore.getState().drafts;
    expect(d[PATH].observations[0].count).toBe(3);
    expect(d[P2].observations[0].count).toBe(1);
  });

  it('applying Ghost via the store clears real species', () => {
    useDraftStore.getState().addSpecies(CTX, [target()], tag(GHOST.label, 1, GHOST.commonName));
    expect(useDraftStore.getState().drafts[PATH].observations.map((o) => o.scientificName)).toEqual([
      GHOST.label,
    ]);
  });
});

describe('blankDraft', () => {
  it('seeds observations from the full base set (deep-copied)', () => {
    const d = blankDraft(CTX, PATH, DEP, BASE);
    expect(d.observations.map((o) => o.scientificName)).toEqual(['Odocoileus hemionus', 'Canis latrans']);
    expect(d.observations).not.toBe(BASE.observations);
  });

  it('seeds an empty set when no base is supplied', () => {
    expect(blankDraft(CTX, PATH, DEP).observations).toEqual([]);
  });
});
