import type { DraftObservation, DraftRecord } from './db';

export type DiscardChange = {
  kind: 'species-added' | 'species-removed' | 'count-changed' | 'species-updated' | 'questionable' | 'timestamp';
  label: string;
};

export type DiscardImageSummary = {
  mediaPath: string;
  displayName: string;
  changes: DiscardChange[];
};

const speciesName = (o: DraftObservation) => o.commonName || o.requestedSpecies || o.scientificName;

const sameDetails = (a: DraftObservation, b: DraftObservation) =>
  a.commonName === b.commonName &&
  a.requestedSpecies === b.requestedSpecies &&
  a.freeTags === b.freeTags;

export function describeDiscardChanges(
  draft: DraftRecord,
  baseObservations: DraftObservation[],
  restoredTimestamp = '',
): DiscardChange[] {
  const changes: DiscardChange[] = [];
  const base = new Map(baseObservations.map((o) => [o.scientificName, o]));
  const next = new Map(draft.observations.map((o) => [o.scientificName, o]));

  for (const original of baseObservations) {
    const edited = next.get(original.scientificName);
    if (!edited) {
      changes.push({ kind: 'species-removed', label: `Removed ${speciesName(original)}` });
      continue;
    }
    if (edited.count !== original.count) {
      changes.push({
        kind: 'count-changed',
        label: `${speciesName(edited)} count ${original.count} → ${edited.count}`,
      });
    }
    if (!sameDetails(original, edited)) {
      changes.push({ kind: 'species-updated', label: `Updated ${speciesName(edited)} details` });
    }
  }

  for (const edited of draft.observations) {
    if (!base.has(edited.scientificName)) {
      changes.push({
        kind: 'species-added',
        label: `Added ${speciesName(edited)}${edited.count > 1 ? ` ×${edited.count}` : ''}`,
      });
    }
  }
  if (draft.questionable !== !!draft.baseQuestionable)
    changes.push({ kind: 'questionable', label: draft.questionable ? 'Marked Need expert' : 'Cleared Need expert' });
  if (draft.timeOverride && draft.timeOverride !== restoredTimestamp) {
    changes.push({ kind: 'timestamp', label: `Timestamp changed to ${draft.timeOverride}` });
  }
  return changes;
}

export function buildDiscardSummaries(
  drafts: DraftRecord[],
  images: {
    key: string;
    fileName: string;
    baseObservations: DraftObservation[];
    restoredTimestamp?: string;
  }[],
): DiscardImageSummary[] {
  const imagesByKey = new Map(images.map((image) => [image.key, image]));
  const basenames = drafts.map((draft) => {
    const image = imagesByKey.get(draft.mediaPath);
    return image?.fileName || draft.mediaPath.split('/').pop() || draft.mediaPath;
  });
  const counts = new Map<string, number>();
  for (const name of basenames) counts.set(name, (counts.get(name) ?? 0) + 1);

  return drafts.map((draft, index) => {
    const image = imagesByKey.get(draft.mediaPath);
    const basename = basenames[index];
    return {
      mediaPath: draft.mediaPath,
      displayName: (counts.get(basename) ?? 0) > 1 ? draft.mediaPath : basename,
      changes: describeDiscardChanges(
        draft,
        image?.baseObservations ?? [],
        image?.restoredTimestamp,
      ),
    };
  });
}
