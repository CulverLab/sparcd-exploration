import { describe, it, expect } from 'vitest';
import {
  serializeCsvRows,
  parseCsvRows,
  serializeUploadMeta,
  parseUploadMeta,
  buildUploadMeta,
  serializeDeployments,
  MEDIA_COL,
  OBS_COL,
  MEDIA_COLUMN_COUNT,
  OBS_COLUMN_COUNT,
  type Deployment,
} from '@sparcd/camtrap';
import { mergeObservations, parseObservations, mergeMedia, parseDeployments } from '@sparcd/camtrap';
import {
  buildSyncPlan,
  runSync,
  snapshotStamp,
  type CanonicalState,
  type SyncIO,
  type SyncPlan,
} from '../src/lib/sync';
import type { SyncJournal } from '../src/lib/syncJournal';
import { sha256Hex } from '../src/lib/hash';
import type { TagImage } from '../src/lib/workspace';
import type { DraftRecord, DraftObservation } from '../src/lib/db';
import { blankDraft, addObservation } from '../src/lib/drafts';
import { buildTagImages } from '../src/lib/workspace';

const obs = (
  scientificName: string,
  count = 1,
  commonName = '',
  requestedSpecies = '',
): DraftObservation => ({ scientificName, commonName, count, requestedSpecies, freeTags: '' });

const PREFIX = 'Collections/uuid/Uploads/2024.01.15.10.00.00/';
const DEP = 'uuid:SAN15';
const K1 = `${PREFIX}IMG001.JPG`;
const K2 = `${PREFIX}IMG002.JPG`;

function mediaRow(key: string, ts: string): string[] {
  const r = new Array<string>(MEDIA_COLUMN_COUNT).fill('');
  r[MEDIA_COL.mediaId] = key;
  r[MEDIA_COL.deploymentId] = DEP;
  r[MEDIA_COL.sequenceId] = key;
  r[MEDIA_COL.timestamp] = ts;
  r[MEDIA_COL.filePath] = key;
  r[MEDIA_COL.fileName] = key.split('/').pop()!;
  r[MEDIA_COL.mediaType] = 'image/jpeg';
  r[MEDIA_COL.favorite] = 'false';
  return r;
}

function obsRow(key: string, ts: string, sci: string): string[] {
  const r = new Array<string>(OBS_COLUMN_COUNT).fill('');
  r[OBS_COL.observationId] = `${key}:0`;
  r[OBS_COL.deploymentId] = DEP;
  r[OBS_COL.mediaId] = key;
  r[OBS_COL.timestamp] = ts;
  r[OBS_COL.cameraSetup] = 'false';
  r[OBS_COL.scientificName] = sci;
  r[OBS_COL.count] = '1';
  r[OBS_COL.countNew] = '0';
  return r;
}

const MEDIA_CSV = serializeCsvRows([
  mediaRow(K1, '2024-01-10T08:00:00'),
  mediaRow(K2, '2024-01-10T08:00:30'),
]);
const OBS_CSV = serializeCsvRows([obsRow(K1, '2024-01-10T08:00:00', 'Puma concolor')]);
const CURRENT_DEPLOYMENT: Deployment = {
  deploymentId: DEP,
  locationId: 'SAN15',
  locationName: 'San Pedro 15',
  latitude: 31.5,
  longitude: -110.2,
  elevation: 1200,
};
const DEPLOYMENTS_CSV = serializeDeployments([CURRENT_DEPLOYMENT]);
const NEW_DEPLOYMENT: Deployment = {
  deploymentId: 'uuid:SAN22',
  locationId: 'SAN22',
  locationName: 'San Pedro 22',
  latitude: 31.7,
  longitude: -110.4,
  elevation: 1300,
};
const META_CSV = serializeUploadMeta(
  buildUploadMeta({
    uploadUser: 'orig',
    date: new Date('2024-01-15T10:00:00Z'),
    imageCount: 2,
    imagesWithSpecies: 1,
    bucket: 'sparcd-x',
    uploadPath: PREFIX,
    description: '',
  }),
);

async function canonical(over: Partial<Record<'media' | 'observations' | 'deployments' | 'uploadMeta', string>> = {}): Promise<CanonicalState> {
  return {
    media: { text: over.media ?? MEDIA_CSV, etag: '"media-1"', hash: await sha256Hex(over.media ?? MEDIA_CSV) },
    observations: { text: over.observations ?? OBS_CSV, etag: '"obs-1"', hash: await sha256Hex(over.observations ?? OBS_CSV) },
    deployments: { text: over.deployments ?? DEPLOYMENTS_CSV, etag: '"dep-1"', hash: await sha256Hex(over.deployments ?? DEPLOYMENTS_CSV) },
    uploadMeta: { text: over.uploadMeta ?? META_CSV, etag: '"meta-1"', hash: await sha256Hex(over.uploadMeta ?? META_CSV) },
  };
}

const IMAGES: TagImage[] = [
  { key: K1, fileName: 'IMG001.JPG', deploymentId: DEP, baseTimestamp: '2024-01-10T08:00:00', baseObservations: [obs('Puma concolor', 1)] },
  { key: K2, fileName: 'IMG002.JPG', deploymentId: DEP, baseTimestamp: '2024-01-10T08:00:30', baseObservations: [] },
];

function draft(over: Partial<DraftRecord>): DraftRecord {
  return {
    id: '', bucket: 'sparcd-x', uploadPrefix: PREFIX, mediaPath: '', deploymentId: DEP,
    observations: [],
    questionable: false, timeOverride: null, lastEdited: '', dirty: true, ...over,
  };
}

// Add a species to the untagged IMG002.
const ADD_DRAFTS: Record<string, DraftRecord> = {
  [K2]: draft({ mediaPath: K2, observations: [obs('Canis latrans', 1, 'Coyote')] }),
};

const NOW = new Date('2024-01-20T14:30:00');

type Recorder = {
  snapshots: { key: string; body: string }[];
  baselines: CanonicalState[];
  replaces: { key: string; body: string; etag: string }[];
  journals: SyncJournal[];
  cleared: number;
};

function fakeIO(
  current: CanonicalState,
  opts: {
    snapshotFailsOn?: (key: string) => boolean;
    replaceError?: (key: string) => Error | null;
  } = {},
): { io: SyncIO; rec: Recorder } {
  const rec: Recorder = { snapshots: [], baselines: [], replaces: [], journals: [], cleared: 0 };
  const io: SyncIO = {
    loadCanonical: async () => current,
    writeSnapshot: async (key, body) => {
      if (opts.snapshotFailsOn?.(key))
        throw Object.assign(new Error('exists'), { name: 'PreconditionFailedError', $metadata: { httpStatusCode: 412 } });
      rec.snapshots.push({ key, body });
    },
    replace: async (key, body, etag) => {
      const err = opts.replaceError?.(key);
      if (err) throw err;
      rec.replaces.push({ key, body, etag });
      return { etag: `"new-${key.split('/').pop()}"` };
    },
    saveJournal: async (j) => rec.journals.push(structuredClone(j)),
    clearJournal: async () => void rec.cleared++,
    now: () => NOW,
  };
  return { io, rec };
}

const baseFrom = (c: CanonicalState) => ({
  media: { etag: c.media.etag, hash: c.media.hash },
  observations: { etag: c.observations.etag, hash: c.observations.hash },
  deployments: { etag: c.deployments.etag, hash: c.deployments.hash },
  uploadMeta: { etag: c.uploadMeta.etag, hash: c.uploadMeta.hash },
});

describe('buildSyncPlan', () => {
  it('classifies an addition and emits one observation edit', () => {
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    expect(plan.summary).toEqual({
      additions: 1,
      modifications: 0,
      removals: 0,
      timeCorrections: 0,
      confirmations: 0,
      expertMarked: 0,
      expertCleared: 0,
    });
    expect(plan.tagEdits).toHaveLength(1);
    expect(plan.tagEdits[0].mediaId).toBe(K2);
    expect(plan.tagEdits[0].observations[0].scientificName).toBe('Canis latrans');
    expect(plan.timeEdits).toHaveLength(0);
  });

  it('attributes new identifications to the connected storage username while preserving other work', () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [{ ...obs('Puma concolor', 1), classifiedBy: 'fielduser' }],
    }];
    const plan = buildSyncPlan(
      images,
      {
        [K1]: draft({
          mediaPath: K1,
          observations: [
            { ...obs('Puma concolor', 1), classifiedBy: 'fielduser' },
            obs('Canis latrans', 1, 'Coyote'),
          ],
        }),
      },
      null,
      null,
      'harold',
    );
    expect(plan.tagEdits[0].observations.find((o) => o.scientificName === 'Canis latrans')?.classifiedBy).toBe('harold');
    expect(plan.tagEdits[0].observations.find((o) => o.scientificName === 'Puma concolor')?.classifiedBy).toBe('fielduser');
  });

  it('preserves canonical attribution when a legacy draft omitted classifiedBy', () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [{ ...obs('Puma concolor', 1), classifiedBy: 'fielduser' }, obs('Canis latrans', 1)],
    }];
    const plan = buildSyncPlan(
      images,
      {
        [K1]: draft({
          mediaPath: K1,
          observations: [obs('Puma concolor', 1), { ...obs('Canis latrans', 1), count: 2 }],
        }),
      },
      null,
      null,
      'harold',
    );
    expect(plan.tagEdits[0].observations.find((o) => o.scientificName === 'Puma concolor')?.classifiedBy).toBe('fielduser');
    expect(plan.tagEdits[0].observations.find((o) => o.scientificName === 'Canis latrans')?.classifiedBy).toBe('harold');
  });

  it("does not credit the editor for an old image's species they didn't touch", () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [obs('Puma concolor', 1), obs('Canis latrans', 1, 'Coyote')],
    }];
    const plan = buildSyncPlan(
      images,
      { [K1]: draft({ mediaPath: K1, observations: [obs('Puma concolor', 2), obs('Canis latrans', 1, 'Coyote')] }) },
      null,
      null,
      'harold',
    );
    expect(plan.tagEdits[0].observations.find((o) => o.scientificName === 'Puma concolor')?.classifiedBy).toBe('harold');
    expect(plan.tagEdits[0].observations.find((o) => o.scientificName === 'Canis latrans')?.classifiedBy).toBeUndefined();
  });

  // #368 (Q12): a review of an existing identification must record the
  // reviewer and date even when nothing about the species/count changes.
  // Re-applying a species already present is how that confirmation is made —
  // The store records the reviewer separately; the original attribution is
  // retained in the canonical row.
  it('records a confirmation as its own category, not a modification, when a species is re-applied unchanged', () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [{ ...obs('Puma concolor', 1), classifiedBy: 'fielduser', classificationTimestamp: '2024-01-11T00:00:00.000Z' }],
    }];
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: images[0].baseObservations,
    });
    const reapplied = addObservation(seeded.observations, {
      scientificName: 'Puma concolor',
      commonName: '',
      count: 1,
      classifiedBy: 'harold',
      classificationTimestamp: '2024-01-20T14:30:00.000Z',
    });
    const plan = buildSyncPlan(
      images,
      {
        [K1]: {
          ...seeded,
          observations: reapplied,
          confirmedSpecies: ['Puma concolor'],
          dirty: true,
        },
      },
      null,
    );
    expect(plan.summary).toEqual({
      additions: 0,
      modifications: 0,
      removals: 0,
      timeCorrections: 0,
      confirmations: 1,
      expertMarked: 0,
      expertCleared: 0,
    });
    expect(plan.tagEdits).toHaveLength(1);
    const written = plan.tagEdits[0].observations[0];
    expect(written.scientificName).toBe('Puma concolor');
    expect(written.count).toBe(1);
    expect(written.classifiedBy).toBe('fielduser');
    expect(written.classificationTimestamp).toBe('2024-01-11T00:00:00.000Z');
  });

  it('does not confirm an untouched draft (no attribution refresh, no edit)', () => {
    // The same content-unchanged shape as a confirmation, but reached without
    // ever calling addObservation — nothing distinguishes it from an upload
    // nobody has looked at, so no edit (and no review record) is emitted.
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1)],
    });
    const plan = buildSyncPlan(IMAGES, { [K1]: { ...seeded, dirty: true } }, null);
    expect(plan.summary.confirmations).toBe(0);
    expect(plan.tagEdits).toHaveLength(0);
  });

  it('does not infer a confirmation from a legacy draft missing attribution', () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [{ ...obs('Puma concolor', 1), classifiedBy: 'fielduser' }],
    }];
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1)],
    });
    const plan = buildSyncPlan(images, { [K1]: { ...seeded, dirty: true } }, null);
    expect(plan.summary.confirmations).toBe(0);
    expect(plan.tagEdits).toHaveLength(0);
  });

  it('does not credit unrelated legacy species when one species is confirmed', () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [
        { ...obs('Puma concolor', 1), classifiedBy: 'fielduser' },
        obs('Canis latrans', 1, 'Coyote'),
      ],
    }];
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: images[0].baseObservations,
    });
    const reapplied = addObservation(seeded.observations, {
      scientificName: 'Puma concolor',
      commonName: '',
      count: 1,
      classifiedBy: 'harold',
      classificationTimestamp: NOW.toISOString(),
    });
    const plan = buildSyncPlan(images, {
      [K1]: { ...seeded, observations: reapplied, confirmedSpecies: ['Puma concolor'], dirty: true },
    }, null);
    const rows = plan.tagEdits[0].observations;
    expect(plan.summary.confirmations).toBe(1);
    expect(rows.find((o) => o.scientificName === 'Puma concolor')?.classifiedBy).toBe('fielduser');
    expect(rows.find((o) => o.scientificName === 'Canis latrans')?.classifiedBy).toBeUndefined();
  });

  it('counts an explicit confirmation alongside another species edit', () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [{ ...obs('Puma concolor', 1), classifiedBy: 'fielduser' }],
    }];
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: images[0].baseObservations,
    });
    const plan = buildSyncPlan(images, {
      [K1]: {
        ...seeded,
        observations: [
          { ...obs('Puma concolor', 1), classifiedBy: 'harold', classificationTimestamp: NOW.toISOString() },
          obs('Canis latrans', 1, 'Coyote'),
        ],
        confirmedSpecies: ['Puma concolor'],
        dirty: true,
      },
    }, null, null, 'harold');
    expect(plan.summary).toMatchObject({ modifications: 1, confirmations: 1 });
  });

  it('writes a review event only on the species that was re-applied', () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [
        { ...obs('Puma concolor', 1), classifiedBy: 'fielduser' },
        { ...obs('Canis latrans', 1, 'Coyote'), classifiedBy: 'anita' },
      ],
    }];
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: images[0].baseObservations,
    });
    const plan = buildSyncPlan(images, {
      [K1]: {
        ...seeded,
        observations: [
          {
            ...images[0].baseObservations[0],
            reviewEvents: [{ reviewedBy: 'harold', reviewedAt: NOW.toISOString() }],
          },
          images[0].baseObservations[1],
        ],
        confirmedSpecies: ['Puma concolor'],
        dirty: true,
      },
    }, null);
    expect(plan.tagEdits[0].observations[0].reviewEvents).toEqual([
      { reviewedBy: 'harold', reviewedAt: NOW.toISOString() },
    ]);
    expect(plan.tagEdits[0].observations[1].reviewEvents).toBeUndefined();
  });

  // A sync leaves the draft clean, without the review events it wrote, so the
  // next confirm or count edit starts from a draft that holds only its own event.
  const HAROLD = { reviewedBy: 'harold', reviewedAt: '2024-01-12T00:00:00.000Z' };
  const BOB = { reviewedBy: 'bob', reviewedAt: NOW.toISOString() };
  const reviewedPuma: TagImage[] = [{
    ...IMAGES[0],
    baseObservations: [{ ...obs('Puma concolor', 1), classifiedBy: 'fielduser', reviewEvents: [HAROLD] }],
  }];

  it('keeps a stored review when the species is confirmed again', () => {
    const plan = buildSyncPlan(reviewedPuma, {
      [K1]: draft({
        mediaPath: K1,
        observations: [{ ...obs('Puma concolor', 1), classifiedBy: 'fielduser', reviewEvents: [BOB] }],
        confirmedSpecies: ['Puma concolor'],
      }),
    }, null, null, 'bob');
    expect(plan.tagEdits[0].observations[0].reviewEvents).toEqual([HAROLD, BOB]);
  });

  it('keeps a stored review when the count is edited later', () => {
    const plan = buildSyncPlan(reviewedPuma, {
      [K1]: draft({
        mediaPath: K1,
        observations: [{ ...obs('Puma concolor', 2), classifiedBy: 'fielduser', reviewEvents: [BOB] }],
        confirmedSpecies: ['Puma concolor'],
      }),
    }, null, null, 'bob');
    expect(plan.tagEdits[0].observations[0].count).toBe(2);
    expect(plan.tagEdits[0].observations[0].reviewEvents).toEqual([HAROLD, BOB]);
  });

  it('keeps edit-time attribution when the connected account changes before sync', () => {
    const plan = buildSyncPlan(
      [{ ...IMAGES[1], baseObservations: [] }],
      { [K2]: draft({ mediaPath: K2, observations: [{ ...obs('Canis latrans', 1), classifiedBy: 'alice', classificationTimestamp: NOW.toISOString() }] }) },
      null,
      null,
      'bob',
    );
    expect(plan.tagEdits[0].observations[0].classifiedBy).toBe('alice');
  });

  it('keeps confirmation attribution when a time correction is combined with the review', () => {
    const images: TagImage[] = [{
      ...IMAGES[0],
      baseObservations: [{ ...obs('Puma concolor', 1), classifiedBy: 'fielduser' }],
    }];
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [{ ...obs('Puma concolor', 1), classifiedBy: 'harold', classificationTimestamp: NOW.toISOString() }],
    });
    const plan = buildSyncPlan(
      images,
      {
        [K1]: {
          ...seeded,
          confirmedSpecies: ['Puma concolor'],
          timeOverride: '2024-01-10T09:00:00',
          dirty: true,
        },
      },
      null,
    );
    expect(plan.summary).toMatchObject({ confirmations: 1, timeCorrections: 1 });
    expect(plan.tagEdits[0].observations[0].classifiedBy).toBe('fielduser');
    expect(plan.tagEdits[0].mediaTimestamp).toBe('2024-01-10T09:00:00');
  });

  it('classifies a detag as a removal with empty observations', () => {
    const plan = buildSyncPlan(IMAGES, {
      [K1]: draft({ mediaPath: K1, observations: [], removedSpecies: ['Puma concolor'] }),
    }, null);
    expect(plan.summary.removals).toBe(1);
    expect(plan.tagEdits[0].observations).toEqual([]);
    expect(plan.tagEdits[0].removedSpecies).toEqual(['Puma concolor']);
  });

  it('records a partial removal without inferring removals from a changed legacy draft', () => {
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1), obs('Canis latrans', 1, 'Coyote')],
    });
    const plan = buildSyncPlan(
      [{ ...IMAGES[0], baseObservations: seeded.observations }],
      { [K1]: { ...seeded, observations: [obs('Canis latrans', 1, 'Coyote')], removedSpecies: ['Puma concolor'], dirty: true } },
      null,
    );
    expect(plan.tagEdits[0].removedSpecies).toEqual(['Puma concolor']);
    expect(plan.tagEdits[0].observations[0].removedSpecies).toEqual(['Puma concolor']);
    const legacy = buildSyncPlan(
      [{ ...IMAGES[0], baseObservations: seeded.observations }],
      { [K1]: { ...seeded, observations: [obs('Canis latrans', 1, 'Coyote')], dirty: true } },
      null,
    );
    expect(legacy.tagEdits[0].removedSpecies).toEqual([]);
  });

  it('marks a one-for-one species replacement with the previous scientific name', () => {
    const plan = buildSyncPlan(
      IMAGES,
      {
        [K1]: draft({
          mediaPath: K1,
          observations: [obs('Canis latrans', 1, 'Coyote')],
        }),
      },
      null,
    );
    expect(plan.tagEdits[0].observations).toEqual([
      expect.objectContaining({ scientificName: 'Canis latrans', correctedFrom: 'Puma concolor' }),
    ]);
  });

  it('does not mark count-only, add-only, or removal-only edits as replacements', () => {
    const count = buildSyncPlan(
      IMAGES,
      { [K1]: draft({ mediaPath: K1, observations: [obs('Puma concolor', 2)] }) },
      null,
    );
    expect(count.tagEdits[0].observations[0].correctedFrom).toBeUndefined();

    const addition = buildSyncPlan(
      IMAGES,
      { [K2]: draft({ mediaPath: K2, observations: [obs('Canis latrans', 1, 'Coyote')] }) },
      null,
    );
    expect(addition.tagEdits[0].observations[0].correctedFrom).toBeUndefined();

    const removal = buildSyncPlan(
      IMAGES,
      { [K1]: draft({ mediaPath: K1, observations: [] }) },
      null,
    );
    expect(removal.tagEdits[0].observations).toEqual([]);
  });

  it('syncs a Need expert-only toggle as a media edit', () => {
    const plan = buildSyncPlan(
      IMAGES,
      { [K1]: draft({ mediaPath: K1, observations: [obs('Puma concolor', 1)], questionable: true }) },
      null,
    );
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(0);
    expect(plan.statusEdits).toEqual([{ mediaId: K1, deploymentId: DEP, timestamp: '2024-01-10T08:00:00', needExpert: true, observations: [] }]);
    expect(plan.summary.expertMarked).toBe(1);
  });

  it('does not detag a base-tagged image when questionable is toggled (seeded draft)', () => {
    // Mirror the real store path: toggling questionable on an already-tagged
    // image creates a draft *seeded from the base set*, then flips questionable.
    // A draft that did not carry the base observations forward would be
    // misclassified as a detag — the regression this guards.
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1)],
    });
    const plan = buildSyncPlan(IMAGES, { [K1]: { ...seeded, questionable: true, dirty: true } }, null);
    expect(plan.summary.removals).toBe(0);
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(0);
    expect(plan.statusEdits).toHaveLength(1);
  });

  it('ignores a clean (already-synced) draft so it is not re-applied', () => {
    // A non-dirty draft carries no pending intent; it must defer to the base.
    const plan = buildSyncPlan(
      IMAGES,
      { [K2]: draft({ mediaPath: K2, observations: [obs('Canis latrans', 1, 'Coyote')], dirty: false }) },
      null,
    );
    expect(plan.tagEdits).toHaveLength(0);
  });

  it('emits a time-only media edit for a per-image override that keeps the tag', () => {
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1)],
    });
    const plan = buildSyncPlan(
      IMAGES,
      { [K1]: { ...seeded, timeOverride: '2024-01-10T09:00:00', dirty: true } },
      null,
    );
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(1);
    expect(plan.timeEdits[0].mediaTimestamp).toBe('2024-01-10T09:00:00');
    expect(plan.timeEdits[0].observations).toEqual([]);
    expect(plan.summary.timeCorrections).toBe(1);
  });

  // --- Multi-species data-loss proofs (RED against the old single-label code) -

  const K3 = `${PREFIX}IMG003.JPG`;
  const MULTI_IMAGES: TagImage[] = [
    {
      key: K3,
      fileName: 'IMG003.JPG',
      deploymentId: DEP,
      baseTimestamp: '2024-01-10T08:01:00',
      baseObservations: [obs('Odocoileus hemionus', 1, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')],
    },
  ];

  it('a multi-species base image gaining a third species carries ALL three, never collapsed', () => {
    const draftObs = [
      obs('Odocoileus hemionus', 1, 'Mule Deer'),
      obs('Canis latrans', 1, 'Coyote'),
      obs('Lynx rufus', 1, 'Bobcat'),
    ];
    const plan = buildSyncPlan(MULTI_IMAGES, { [K3]: draft({ mediaPath: K3, observations: draftObs }) }, null);
    expect(plan.tagEdits).toHaveLength(1);
    expect(plan.tagEdits[0].observations.map((o) => o.scientificName)).toEqual([
      'Odocoileus hemionus',
      'Canis latrans',
      'Lynx rufus',
    ]);
  });

  it('editing one count on a multi-species image keeps the other species', () => {
    const draftObs = [obs('Odocoileus hemionus', 3, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')];
    const plan = buildSyncPlan(MULTI_IMAGES, { [K3]: draft({ mediaPath: K3, observations: draftObs }) }, null);
    expect(plan.tagEdits).toHaveLength(1);
    expect(plan.tagEdits[0].observations).toHaveLength(2);
    const deer = plan.tagEdits[0].observations.find((o) => o.scientificName === 'Odocoileus hemionus');
    expect(deer?.count).toBe(3);
    expect(plan.tagEdits[0].observations.find((o) => o.scientificName === 'Canis latrans')).toBeTruthy();
  });
});

describe('buildSyncPlan — location correction (issue #279)', () => {
  it('carries the pending location as locationEdit with no images touched', () => {
    const plan = buildSyncPlan(IMAGES, {}, null, NEW_DEPLOYMENT);
    expect(plan.locationEdit).toEqual(NEW_DEPLOYMENT);
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(0);
  });

  it('stamps the new deployment id on a tag edit made in the same sync', () => {
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null, NEW_DEPLOYMENT);
    expect(plan.tagEdits[0].deploymentId).toBe(NEW_DEPLOYMENT.deploymentId);
  });

  it('stamps the new deployment id on a time edit made in the same sync', () => {
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, K1, DEP, {
      observations: [obs('Puma concolor', 1)],
    });
    const plan = buildSyncPlan(
      IMAGES,
      { [K1]: { ...seeded, timeOverride: '2024-01-10T09:00:00', dirty: true } },
      null,
      NEW_DEPLOYMENT,
    );
    expect(plan.timeEdits[0].deploymentId).toBe(NEW_DEPLOYMENT.deploymentId);
  });

  it('null pendingLocation leaves locationEdit null (no correction queued)', () => {
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    expect(plan.locationEdit).toBeNull();
  });
});

// The headline round-trip proof: a multi-species image plus a draft that adds a
// third species, run through the real merge, must keep ALL intended species.
describe('buildSyncPlan → mergeObservations round trip', () => {
  const KX = `${PREFIX}IMGX.JPG`;
  const X_IMAGES: TagImage[] = [
    {
      key: KX,
      fileName: 'IMGX.JPG',
      deploymentId: DEP,
      baseTimestamp: '2024-01-10T08:00:00',
      baseObservations: [obs('Odocoileus hemionus', 1, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')],
    },
  ];
  const X_OBS_CSV = serializeCsvRows([
    obsRow(KX, '2024-01-10T08:00:00', 'Odocoileus hemionus'),
    obsRow(KX, '2024-01-10T08:00:00', 'Canis latrans'),
  ]);

  it('retains all intended species for the image, never one row', () => {
    const draftObs = [
      obs('Odocoileus hemionus', 1, 'Mule Deer'),
      obs('Canis latrans', 1, 'Coyote'),
      obs('Lynx rufus', 1, 'Bobcat'),
    ];
    const plan = buildSyncPlan(X_IMAGES, { [KX]: draft({ mediaPath: KX, observations: draftObs }) }, null);
    const merged = mergeObservations(X_OBS_CSV, plan.tagEdits);
    const rows = parseObservations(merged).filter((r) => r.mediaId === KX);
    expect(rows.map((r) => r.scientificName).sort()).toEqual([
      'Canis latrans',
      'Lynx rufus',
      'Odocoileus hemionus',
    ]);
  });

  it('preserve-by-inaction: a time-only edit leaves both species rows untouched', () => {
    // Base has two species; the user changes ONLY the timestamp. The tag set is
    // unchanged, so the edit must route to timeEdits (observations:[]) — never
    // through mergeObservations — and both canonical rows survive byte-for-byte.
    const seeded = blankDraft({ bucket: 'sparcd-x', uploadPrefix: PREFIX }, KX, DEP, {
      observations: [obs('Odocoileus hemionus', 1, 'Mule Deer'), obs('Canis latrans', 1, 'Coyote')],
    });
    const plan = buildSyncPlan(
      X_IMAGES,
      { [KX]: { ...seeded, timeOverride: '2024-01-10T09:00:00', dirty: true } },
      null,
    );
    expect(plan.tagEdits).toHaveLength(0);
    expect(plan.timeEdits).toHaveLength(1);
    // observations.csv is untouched (tagEdits empty) → both rows survive verbatim.
    const merged = mergeObservations(X_OBS_CSV, plan.tagEdits);
    expect(merged).toBe(X_OBS_CSV);
    const rows = parseObservations(merged).filter((r) => r.mediaId === KX);
    expect(rows).toHaveLength(2);
    // The media row's col-4 timestamp is rewritten by the time edit.
    const mediaCsv = serializeCsvRows([mediaRow(KX, '2024-01-10T08:00:00')]);
    const mergedMedia = mergeMedia(mediaCsv, plan.timeEdits);
    const mediaRowOut = parseCsvRows(mergedMedia).find((r) => r[MEDIA_COL.mediaId] === KX)!;
    expect(mediaRowOut[MEDIA_COL.timestamp]).toBe('2024-01-10T09:00:00');
  });

  it('marks a corrected estimated timestamp as manual', () => {
    const estimated = { ...IMAGES[1], timestampSource: 'interpolated' as const };
    const plan = buildSyncPlan(
      [estimated],
      { [K2]: draft({ mediaPath: K2, timeOverride: '2024-01-10T09:00:00' }) },
      null,
    );
    expect(plan.timeEdits[0].timestampSource).toBe('manual');

    const row = mediaRow(K2, '2024-01-10T08:00:30');
    row[MEDIA_COL.comments] = '[TIMESTAMP:interpolated][UPLOADER:kept]';
    const merged = mergeMedia(serializeCsvRows([row]), plan.timeEdits);
    const output = parseCsvRows(merged)[0];
    expect(output[MEDIA_COL.comments]).toBe('[TIMESTAMP:manual][UPLOADER:kept]');
  });
});

describe('runSync — dry-run default writes nothing', () => {
  it('returns the planned writes and touches no I/O', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: true },
      io,
    );
    expect(res.status).toBe('dry-run');
    if (res.status === 'dry-run') {
      // observations changed + UploadMeta always changes; media is untouched.
      expect(res.writes.map((w) => w.role).sort()).toEqual(['observations', 'uploadMeta']);
      expect(res.snapshotPrefix).toContain('.sparcd-tagger-snapshots/jg/');
    }
    expect(rec.snapshots).toHaveLength(0);
    expect(rec.replaces).toHaveLength(0);
  });

  it('reports noop when there is nothing to sync', async () => {
    const cur = await canonical();
    const { io } = fakeIO(cur);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: emptyPlan(), dryRun: false },
      io,
    );
    expect(res.status).toBe('noop');
  });
});

describe('runSync — live write path', () => {
  it('combines Need expert with species, time, and location edits without losing media comments', async () => {
    const mediaRows = parseCsvRows(MEDIA_CSV);
    mediaRows[0][MEDIA_COL.comments] = '[TIMESTAMP:spread][FUTURE:keep]';
    const cur = await canonical({ media: serializeCsvRows(mediaRows) });
    const images = [{ ...IMAGES[0], timestampSource: 'spread' as const }, IMAGES[1]];
    const pending = draft({
      mediaPath: K1,
      observations: [...IMAGES[0].baseObservations, obs('Canis latrans', 1, 'Coyote')],
      timeOverride: '2024-01-10T09:00:00',
      questionable: true,
    });
    const plan = buildSyncPlan(images, { [K1]: pending }, null, NEW_DEPLOYMENT);
    const { io, rec } = fakeIO(cur);
    const result = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false }, io);
    expect(result.status).toBe('synced');
    const written = (role: string) => rec.replaces.find((entry) => entry.key.endsWith(`${role}.csv`))?.body;
    const media = parseCsvRows(written('media')!)[0];
    expect(media[MEDIA_COL.comments]).toContain('[FUTURE:keep]');
    expect(media[MEDIA_COL.comments]).toContain('[TIMESTAMP:manual]');
    expect(media[MEDIA_COL.comments].match(/\[NEED_EXPERT:true\]/g)).toHaveLength(1);
    expect(media[MEDIA_COL.deploymentId]).toBe(NEW_DEPLOYMENT.deploymentId);
    expect(parseObservations(written('observations')!).filter((row) => row.mediaId === K1).map((row) => row.scientificName)).toEqual(['Puma concolor', 'Canis latrans']);
    expect(parseUploadMeta(rec.replaces.find((entry) => entry.key.endsWith('UploadMeta.json'))!.body).imagesWithSpecies).toBe(1);
  });
  it('writes a status-only change to media.csv, not observations.csv, and grounds it against media ETag', async () => {
    const cur = await canonical();
    const plan = buildSyncPlan(IMAGES, { [K1]: draft({ mediaPath: K1, observations: IMAGES[0].baseObservations, questionable: true }) }, null);
    const { io, rec } = fakeIO(cur);
    const res = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false }, io);
    expect(res.status).toBe('synced');
    expect(rec.replaces.map((write) => write.key.split('/').pop())).toEqual(['media.csv', 'UploadMeta.json']);
    expect(rec.replaces[0].etag).toBe('"media-1"');
    expect(rec.journals[0].syncedMediaIds).toEqual([K1]);
    expect(rec.journals[0].receipt?.draftRevisions).toEqual(plan.draftRevisions);
    expect(rec.journals[0].receipt?.mediaTimestamps[K1]).toBe(IMAGES[0].baseTimestamp);
    expect(parseCsvRows(rec.replaces[0].body).find((row) => row[MEDIA_COL.mediaId] === K1)?.[MEDIA_COL.comments]).toContain('[NEED_EXPERT:true]');
    if (res.status === 'synced') expect(res.syncedMediaIds).toEqual([K1]);

    const stale = { ...baseFrom(cur), media: { etag: '"media-OLD"', hash: cur.media.hash } };
    const failed = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: stale, plan, dryRun: false }, fakeIO(cur).io);
    expect(failed.status).toBe('conflict');
    if (failed.status === 'conflict') expect(failed.role).toBe('media');
  });
  it('creates the immutable original baseline before the first rollback snapshot', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    let baselineCreated = false;
    io.ensureOriginalBaseline = async (state) => {
      if (!baselineCreated) {
        baselineCreated = true;
        rec.baselines.push(state);
      }
    };
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: buildSyncPlan(IMAGES, ADD_DRAFTS, null), dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');
    expect(rec.baselines).toHaveLength(1);
    expect(rec.baselines[0].media.text).toBe(MEDIA_CSV);
    expect(rec.snapshots[0].key).toContain('.sparcd-tagger-snapshots/');
  });

  it('snapshots all four files (+manifest last), replaces changed files in order, clears the journal', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );

    expect(res.status).toBe('synced');
    // Snapshot set is the full pre-change canonical state, manifest written last.
    expect(rec.snapshots.map((s) => s.key.split('/').pop())).toEqual([
      'media.csv', 'observations.csv', 'deployments.csv', 'UploadMeta.json', 'manifest.json',
    ]);
    // Only changed canonical files are replaced, media first then meta — here
    // media is unchanged so it's observations then UploadMeta.
    expect(rec.replaces.map((r) => r.key.split('/').pop())).toEqual([
      'observations.csv', 'UploadMeta.json',
    ]);
    expect(rec.replaces[0].etag).toBe('"obs-1"'); // wrote against the reviewed ETag
    const writtenObservations = parseObservations(rec.replaces[0].body);
    expect(
      writtenObservations.find((row) => row.scientificName === 'Canis latrans')?.observationId,
    ).toBe('IMG002.JPG:0');
    expect(
      writtenObservations.find((row) => row.scientificName === 'Puma concolor')?.observationId,
    ).toBe(`${K1}:0`);
    expect(rec.cleared).toBe(1);
    if (res.status === 'synced') {
      expect(res.summary.additions).toBe(1);
      // Reports exactly the written media so the caller clears only those drafts.
      expect(res.syncedMediaIds).toEqual([K2]);
    }
  });

  it('enters the conflict view when a canonical file changed since grounding', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const staleBase = { ...baseFrom(cur), observations: { etag: '"obs-OLD"', hash: cur.observations.hash } };
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: staleBase, plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('conflict');
    if (res.status === 'conflict') expect(res.role).toBe('observations');
    expect(rec.replaces).toHaveLength(0); // nothing written on conflict
  });

  it('re-stamps the snapshot +1s and retries once on a 412 collision', async () => {
    const cur = await canonical();
    const firstStamp = snapshotStamp(NOW);
    const { io, rec } = fakeIO(cur, { snapshotFailsOn: (key) => key.includes(firstStamp) });
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');
    // Every recorded snapshot landed under the bumped (+1s) prefix, manifest last.
    const bumped = snapshotStamp(new Date(NOW.getTime() + 1000));
    expect(rec.snapshots.every((s) => s.key.includes(bumped))).toBe(true);
    expect(rec.snapshots.at(-1)!.key.endsWith('manifest.json')).toBe(true);
  });

  it('reports unsupported when the backend will not enforce IfMatch (501)', async () => {
    const cur = await canonical();
    const { io } = fakeIO(cur, {
      replaceError: () => Object.assign(new Error('no'), { name: 'ConditionalPutUnsupportedError' }),
    });
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('unsupported');
  });
});

describe('runSync — location correction (issue #279)', () => {
  it('refuses a location with redacted coordinates before writing any canonical file', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const redactedLocation = { ...NEW_DEPLOYMENT, latitude: null, longitude: null };
    const plan = buildSyncPlan(IMAGES, {}, null, redactedLocation);

    await expect(runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    )).rejects.toThrow('The selected location does not include exact coordinates.');

    expect(rec.snapshots).toHaveLength(0);
    expect(rec.replaces).toHaveLength(0);
  });

  it('rewrites deployments.csv and every media/observation deployment id', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, {}, null, NEW_DEPLOYMENT);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');

    // media, observations, and deployments all change; UploadMeta always does.
    expect(rec.replaces.map((r) => r.key.split('/').pop()).sort()).toEqual([
      'UploadMeta.json',
      'deployments.csv',
      'media.csv',
      'observations.csv',
    ]);

    const writtenMedia = rec.replaces.find((r) => r.key.endsWith('media.csv'))!;
    const mediaRows = parseCsvRows(writtenMedia.body);
    expect(mediaRows.every((r) => r[MEDIA_COL.deploymentId] === NEW_DEPLOYMENT.deploymentId)).toBe(true);

    const writtenObs = rec.replaces.find((r) => r.key.endsWith('observations.csv'))!;
    const obsRows = parseCsvRows(writtenObs.body);
    expect(obsRows.every((r) => r[OBS_COL.deploymentId] === NEW_DEPLOYMENT.deploymentId)).toBe(true);

    const writtenDeployments = rec.replaces.find((r) => r.key.endsWith('deployments.csv'))!;
    const depRows = parseDeployments(writtenDeployments.body);
    expect(depRows).toHaveLength(1);
    expect(depRows[0].deploymentId).toBe(NEW_DEPLOYMENT.deploymentId);
    expect(depRows[0].locationName).toBe(NEW_DEPLOYMENT.locationName);
  });

  it('a species edit and a location correction in the same sync both land', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null, NEW_DEPLOYMENT);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');

    const writtenObs = rec.replaces.find((r) => r.key.endsWith('observations.csv'))!;
    const rows = parseObservations(writtenObs.body);
    expect(rows.every((r) => r.deploymentId === NEW_DEPLOYMENT.deploymentId)).toBe(true);
    expect(rows.find((r) => r.scientificName === 'Canis latrans')).toBeTruthy();
    expect(rows.find((r) => r.scientificName === 'Puma concolor')).toBeTruthy();
  });

  it('preserves unrelated deployments and rows when the target deployment already exists', async () => {
    const target = { ...NEW_DEPLOYMENT };
    const other: Deployment = {
      deploymentId: 'uuid:OTHER', locationId: 'OTHER', locationName: 'Other',
      latitude: 32, longitude: -111, elevation: 900,
    };
    const otherMedia = mediaRow('Collections/uuid/Uploads/2024.01.15.10.00.00/OTHER.JPG', '2024-01-10T08:01:00');
    otherMedia[MEDIA_COL.deploymentId] = other.deploymentId;
    const otherObs = obsRow(otherMedia[MEDIA_COL.mediaId], '2024-01-10T08:01:00', 'Puma concolor');
    otherObs[OBS_COL.deploymentId] = other.deploymentId;
    const cur = await canonical({
      media: serializeCsvRows([...parseCsvRows(MEDIA_CSV), otherMedia]),
      observations: serializeCsvRows([...parseCsvRows(OBS_CSV), otherObs]),
      deployments: serializeDeployments([CURRENT_DEPLOYMENT, target, other]),
    });
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, {}, null, target);
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(res.status).toBe('synced');
    const written = rec.replaces.find((r) => r.key.endsWith('deployments.csv'))!;
    expect(parseDeployments(written.body).map((d) => d.deploymentId)).toEqual([target.deploymentId, other.deploymentId]);
    const media = parseCsvRows(rec.replaces.find((r) => r.key.endsWith('media.csv'))!.body);
    expect(media.find((row) => row[MEDIA_COL.mediaId].endsWith('OTHER.JPG'))?.[MEDIA_COL.deploymentId]).toBe(other.deploymentId);
  });
});

describe('reader-listing contract — snapshot subtree adds no images', () => {
  // The sparcd-web reader recurses subfolders but returns only .jpg/.mp4. So
  // every object the snapshot writes must be a non-image under the snapshots
  // prefix, or it would show up as a taggable image.
  const IMAGE_EXT = /\.(jpe?g|mp4)$/i;

  it('writes only non-image files under .sparcd-tagger-snapshots/', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const plan = buildSyncPlan(IMAGES, ADD_DRAFTS, null);
    await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan, dryRun: false },
      io,
    );
    expect(rec.snapshots.length).toBeGreaterThan(0);
    for (const s of rec.snapshots) {
      expect(s.key).toContain(`${PREFIX}.sparcd-tagger-snapshots/`);
      expect(IMAGE_EXT.test(s.key)).toBe(false);
    }
  });
});

describe('runSync — resume a partial sync from the journal', () => {
  it('cleans only the status draft recorded by a safely resumed journal', async () => {
    const cur = await canonical();
    const media = mergeMedia(cur.media.text, [{ mediaId: K1, deploymentId: DEP, timestamp: IMAGES[0].baseTimestamp, observations: [], needExpert: true }]);
    const journal: SyncJournal = {
      id: `sparcd-x::${PREFIX}`, bucket: 'sparcd-x', uploadPrefix: PREFIX,
      snapshotPrefix: `${PREFIX}.sparcd-tagger-snapshots/jg/stamp/`, user: 'jg', startedAt: NOW.toISOString(),
      syncedMediaIds: [K1],
      receipt: { draftRevisions: { [K1]: 'submitted-revision' }, mediaTimestamps: { [K1]: IMAGES[0].baseTimestamp }, needExpert: { [K1]: true } },
      objects: [
        { role: 'media', key: `${PREFIX}media.csv`, baseETag: cur.media.etag, baseHash: cur.media.hash, body: media, intendedHash: await sha256Hex(media), status: 'pending' },
      ],
    };
    const { io, rec } = fakeIO(cur);
    const result = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: emptyPlan(), dryRun: false, resumeJournal: JSON.parse(JSON.stringify(journal)) }, io);
    expect(result.status).toBe('synced');
    if (result.status === 'synced') {
      expect(result.syncedMediaIds).toEqual([K1]);
      expect(result.receipt).toEqual(journal.receipt);
    }
    expect(rec.replaces).toHaveLength(1);
    expect(rec.replaces[0].body).toBe(media);

    const changed = await canonical({ media: MEDIA_CSV.replace('IMG001.JPG', 'IMG-REMOTE.JPG') });
    const conflict = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: emptyPlan(), dryRun: false, resumeJournal: journal }, fakeIO(changed).io);
    expect(conflict.status).toBe('conflict');
  });
  it('verifies the written object and continues from the first pending one', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    io.ensureOriginalBaseline = async (state) => rec.baselines.push(state);
    const journal: SyncJournal = {
      id: `sparcd-x::${PREFIX}`,
      bucket: 'sparcd-x',
      uploadPrefix: PREFIX,
      snapshotPrefix: `${PREFIX}.sparcd-tagger-snapshots/jg/stamp/`,
      user: 'jg',
      startedAt: NOW.toISOString(),
      objects: [
        { role: 'media', key: `${PREFIX}media.csv`, baseETag: '"media-1"', baseHash: cur.media.hash, body: cur.media.text, intendedHash: cur.media.hash, status: 'written', newETag: '"media-2"' },
        { role: 'observations', key: `${PREFIX}observations.csv`, baseETag: '"obs-1"', baseHash: cur.observations.hash, body: 'OBSBODY', intendedHash: await sha256Hex('OBSBODY'), status: 'pending' },
        { role: 'uploadMeta', key: `${PREFIX}UploadMeta.json`, baseETag: '"meta-1"', baseHash: cur.uploadMeta.hash, body: 'METABODY', intendedHash: await sha256Hex('METABODY'), status: 'pending' },
      ],
    };
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: emptyPlan(), dryRun: false, resumeJournal: journal },
      io,
    );
    expect(res.status).toBe('synced');
    // Media was already written, so resume only writes the two pending objects.
    expect(rec.replaces.map((r) => r.key.split('/').pop())).toEqual(['observations.csv', 'UploadMeta.json']);
    expect(rec.baselines).toHaveLength(1);
    expect(rec.cleared).toBe(1);
  });

  it('a dry-run never writes, even with a resume journal present', async () => {
    const cur = await canonical();
    const { io, rec } = fakeIO(cur);
    const journal: SyncJournal = {
      id: `sparcd-x::${PREFIX}`,
      bucket: 'sparcd-x',
      uploadPrefix: PREFIX,
      snapshotPrefix: `${PREFIX}.sparcd-tagger-snapshots/jg/stamp/`,
      user: 'jg',
      startedAt: NOW.toISOString(),
      objects: [
        { role: 'observations', key: `${PREFIX}observations.csv`, baseETag: '"obs-1"', baseHash: cur.observations.hash, body: 'OBSBODY', intendedHash: await sha256Hex('OBSBODY'), status: 'pending' },
      ],
    };
    const res = await runSync(
      { bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'jg', base: baseFrom(cur), plan: emptyPlan(), dryRun: true, resumeJournal: journal },
      io,
    );
    expect(res.status).toBe('dry-run');
    expect(rec.replaces).toHaveLength(0);
    expect(rec.cleared).toBe(0);
  });
});

function emptyPlan(): SyncPlan {
  return {
    tagEdits: [],
    timeEdits: [],
    statusEdits: [],
    locationEdit: null,
    summary: { additions: 0, modifications: 0, removals: 0, timeCorrections: 0, confirmations: 0, expertMarked: 0, expertCleared: 0 },
  };
}

describe('removal provenance survives later edits', () => {
  const rowWith = (sci: string, comments: string, type = 'animal') => {
    const r = new Array<string>(OBS_COLUMN_COUNT).fill('');
    r[OBS_COL.observationId] = `${K1}:0`; r[OBS_COL.deploymentId] = DEP; r[OBS_COL.mediaId] = K1;
    r[OBS_COL.timestamp] = '2024-01-10T08:00:00'; r[OBS_COL.observationType] = type;
    r[OBS_COL.scientificName] = sci; r[OBS_COL.count] = sci ? '1' : ''; r[OBS_COL.comments] = comments;
    return r;
  };
  const images = (rows: string[][]) => buildTagImages({ mediaCsv: MEDIA_CSV, observationsCsv: serializeCsvRows(rows) });

  it('re-emits a stored [REMOVED:…] marker when the image is edited again', () => {
    const imgs = images([rowWith('Canis latrans', '[COMMONNAME:Coyote][REMOVED:Puma concolor]')]);
    const plan = buildSyncPlan(imgs, { [K1]: draft({ mediaPath: K1, observations: [obs('Canis latrans', 3, 'Coyote')] }) }, null);
    expect(plan.tagEdits[0].observations[0].removedSpecies).toEqual(['Puma concolor']);
  });

  it('drops the stored marker once the removed species is back on the image', () => {
    const imgs = images([rowWith('', '[REMOVED:Puma concolor]', 'blank')]);
    const plan = buildSyncPlan(imgs, { [K1]: draft({ mediaPath: K1, observations: [obs('Puma concolor', 1)] }) }, null);
    expect(plan.tagEdits[0].removedSpecies).toEqual([]);
  });

  it('writes a stored [REMOVED:…] marker once when the surviving row is rewritten', () => {
    const csv = serializeCsvRows([rowWith('Canis latrans', '[COMMONNAME:Coyote][REMOVED:Puma concolor]')]);
    const recount = buildSyncPlan(images([rowWith('Canis latrans', '[COMMONNAME:Coyote][REMOVED:Puma concolor]')]), {
      [K1]: draft({ mediaPath: K1, observations: [obs('Canis latrans', 3, 'Coyote')] }),
    }, null);
    expect(parseObservations(mergeObservations(csv, recount.tagEdits)).map((o) => o.tags)).toEqual([
      '[COMMONNAME:Coyote][REMOVED:Puma concolor]',
    ]);
    const restored = buildSyncPlan(images([rowWith('Canis latrans', '[COMMONNAME:Coyote][REMOVED:Puma concolor]')]), {
      [K1]: draft({ mediaPath: K1, observations: [obs('Canis latrans', 1, 'Coyote'), obs('Puma concolor', 1)] }),
    }, null);
    expect(parseObservations(mergeObservations(csv, restored.tagEdits)).map((o) => o.tags)).toEqual([
      '[COMMONNAME:Coyote]',
      '',
    ]);
  });
});

describe('correction provenance survives later syncs', () => {
  const images = (csv: string) => buildTagImages({ mediaCsv: MEDIA_CSV, observationsCsv: csv });
  const k1Tags = (csv: string) => parseObservations(csv).filter((o) => o.mediaId === K1).map((o) => o.tags);
  const BOB = { reviewedBy: 'bob', reviewedAt: NOW.toISOString() };

  it('keeps [CORRECTED_FROM:…] when the replacement is confirmed in a later sync', () => {
    const swap = buildSyncPlan(images(OBS_CSV), {
      [K1]: draft({ mediaPath: K1, observations: [obs('Canis latrans', 1, 'Coyote')] }),
    }, null);
    const afterSwap = mergeObservations(OBS_CSV, swap.tagEdits);
    expect(k1Tags(afterSwap)).toEqual(['[COMMONNAME:Coyote][CORRECTED_FROM:Puma concolor]']);

    // The synced draft is clean and no longer holds the marker; the confirm starts from it.
    const confirm = buildSyncPlan(images(afterSwap), {
      [K1]: draft({
        mediaPath: K1,
        observations: [{ ...obs('Canis latrans', 1, 'Coyote'), reviewEvents: [BOB] }],
        confirmedSpecies: ['Canis latrans'],
      }),
    }, null, null, 'bob');
    expect(confirm.summary).toMatchObject({ confirmations: 1, modifications: 0 });
    expect(confirm.tagEdits[0].observations[0].correctedFrom).toBe('Puma concolor');
    expect(k1Tags(mergeObservations(afterSwap, confirm.tagEdits))).toEqual([
      `[COMMONNAME:Coyote][CORRECTED_FROM:Puma concolor][REVIEWED_BY:bob][REVIEWED_AT:${BOB.reviewedAt}]`,
    ]);
  });
});

describe('a one-for-one swap is recorded as a correction, not also as a removal', () => {
  const k1Tags = (plan: SyncPlan, csv: string) => parseObservations(mergeObservations(csv, plan.tagEdits))
    .filter((o) => o.mediaId === K1)
    .map((o) => `${o.scientificName} ${o.tags}`);
  const twoSpecies = (a: string, b: string) => serializeCsvRows([
    obsRow(K1, '2024-01-10T08:00:00', a),
    obsRow(K1, '2024-01-10T08:00:00', b),
  ]);
  const imagesOf = (csv: string) => buildTagImages({ mediaCsv: MEDIA_CSV, observationsCsv: csv });

  it('writes only [CORRECTED_FROM:…] for a swap made by removing one species and adding another', () => {
    const plan = buildSyncPlan(imagesOf(OBS_CSV), {
      [K1]: draft({ mediaPath: K1, observations: [obs('Canis latrans', 1, 'Coyote')], removedSpecies: ['Puma concolor'] }),
    }, null);
    expect(plan.tagEdits[0].removedSpecies).toEqual([]);
    expect(k1Tags(plan, OBS_CSV)).toEqual(['Canis latrans [COMMONNAME:Coyote][CORRECTED_FROM:Puma concolor]']);
  });

  it('writes only [REMOVED:…] for a removal with no replacement', () => {
    const csv = twoSpecies('Puma concolor', 'Canis latrans');
    const plan = buildSyncPlan(imagesOf(csv), {
      [K1]: draft({ mediaPath: K1, observations: [obs('Canis latrans', 1, 'Coyote')], removedSpecies: ['Puma concolor'] }),
    }, null);
    expect(k1Tags(plan, csv)).toEqual(['Canis latrans [COMMONNAME:Coyote][REMOVED:Puma concolor]']);
  });

  it('writes each removal once and no correction when several species are swapped at once', () => {
    const csv = twoSpecies('Puma concolor', 'Odocoileus hemionus');
    const plan = buildSyncPlan(imagesOf(csv), {
      [K1]: draft({
        mediaPath: K1,
        observations: [obs('Canis latrans', 1, 'Coyote'), obs('Lynx rufus', 1, 'Bobcat')],
        removedSpecies: ['Puma concolor', 'Odocoileus hemionus'],
      }),
    }, null);
    expect(k1Tags(plan, csv)).toEqual([
      'Canis latrans [COMMONNAME:Coyote][REMOVED:Puma concolor][REMOVED:Odocoileus hemionus]',
      'Lynx rufus [COMMONNAME:Bobcat]',
    ]);
  });
});

describe('automatic-save preservation policy', () => {
  it('retains the original baseline and recovery journal without creating per-edit snapshots', async () => {
    const current = await canonical();
    const { io, rec } = fakeIO(current);
    io.createSnapshots = false;
    io.ensureOriginalBaseline = async state => { rec.baselines.push(state); };
    // The coordinator retains the completed journal until its durable action
    // acknowledgement and Undo record commit together.
    io.clearJournal = async () => {};
    const action = { id: 'action-1', user: 'Alice', at: NOW.toISOString(), changes: [{ kind: 'species' }] };
    const result = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'Alice', base: baseFrom(current),
      plan: buildSyncPlan(IMAGES, ADD_DRAFTS, null), dryRun: false, auditEvents: [action] }, io);
    expect(result.status).toBe('synced');
    expect(rec.snapshots).toEqual([]);
    expect(rec.baselines).toHaveLength(1);
    expect(rec.baselines[0].media.text).toBe(current.media.text);
    expect(rec.journals.at(-1)?.objects.every(object => object.status === 'written')).toBe(true);
    const meta = rec.replaces.find(write => write.key.endsWith('UploadMeta.json'))!;
    expect(JSON.parse(meta.body).taggerActions).toEqual([action]);
  });
});

describe('an interrupted PUT before its local acknowledgement', () => {
  it('recognizes exact intended canonical bytes and recovers its missing receipt without another PUT', async () => {
    const base = await canonical();
    const body = mergeMedia(base.media.text, [{ mediaId: K1, deploymentId: DEP, timestamp: IMAGES[0].baseTimestamp, observations: [], needExpert: true }]);
    const current = await canonical({ media: body });
    const journal: SyncJournal = {
      id: `sparcd-x::${PREFIX}`, bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'original actor',
      startedAt: NOW.toISOString(), snapshotPrefix: `${PREFIX}.sparcd-tagger-snapshots/old/stamp/`,
      objects: [{ role: 'media', key: `${PREFIX}media.csv`, baseETag: base.media.etag, baseHash: base.media.hash, body, intendedHash: await sha256Hex(body), status: 'pending' }],
    };
    const { io, rec } = fakeIO(current);
    const result = await runSync({ bucket: 'sparcd-x', uploadPrefix: PREFIX, user: 'original actor', base: baseFrom(base), plan: emptyPlan(), dryRun: false, resumeJournal: journal }, io);
    expect(result.status).toBe('synced'); expect(rec.replaces).toHaveLength(0); expect(rec.cleared).toBe(1);
    expect(rec.journals.at(-1)?.objects[0].status).toBe('written');
    expect(rec.journals.at(-1)?.objects[0].newETag).toBe(current.media.etag);
  });
});
