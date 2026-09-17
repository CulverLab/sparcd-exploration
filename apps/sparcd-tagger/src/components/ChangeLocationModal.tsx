// Upload-level location-change modal (issue #279). Corrects the whole
// upload's recorded camera location — mirrors `TimeShiftModal`'s chrome and
// non-destructive framing, and the uploader's `DeploymentPicker` for the
// picker itself (issue #279: match the uploader — pick from the shared
// registry only, no create-new-location UI). The correction is stored on the
// `uploads` record and only rewrites `deployments.csv` + every media/
// observation row's deployment id at sync — nothing is touched locally.

import { useMemo, useState } from 'react';
import type { Deployment } from '@sparcd/camtrap';
import { LocationPicker } from './LocationPicker';
import { locationToDeployment, type Location } from '../lib/locations';
import { useStore } from '../store';

/** The registry key a Deployment's recorded coordinates/id map to — lets a
 *  loaded `Deployment` (parsed off `deployments.csv`) preselect its matching
 *  registry entry, the same identity `locationToDeployment` derives it from. */
function keyFor(dep: Deployment): string {
  return `${dep.locationId}|${dep.latitude},${dep.longitude}`;
}

export function ChangeLocationModal({
  canonicalCurrent,
  pending,
  locations,
  collectionUuid,
  totalFrames,
  onApply,
  onClose,
}: {
  /** The upload's currently recorded location on `deployments.csv`, or null if
   *  unreadable. Never the pending correction — the true synced state. */
  canonicalCurrent: Deployment | null;
  /** An already-pending (unsynced) location correction, if one is set. */
  pending: Deployment | null;
  locations: Location[];
  collectionUuid: string;
  totalFrames: number;
  onApply: (location: Deployment | null) => Promise<void>;
  onClose: () => void;
}) {
  const distanceUnit = useStore((s) => s.distanceUnit);
  // What's in effect right now, before this dialog's action: a pending
  // correction if one is queued, otherwise the canonical on-file location.
  const effective = pending ?? canonicalCurrent;
  const [selectedKey, setSelectedKey] = useState<string | null>(effective ? keyFor(effective) : null);

  const selected = useMemo(
    () => locations.find((l) => l.key === selectedKey) ?? null,
    [locations, selectedKey],
  );

  const sameLocation = (location: Deployment | null, candidate: Location | null) => !!location && !!candidate
    && location.locationId === candidate.id
    && location.locationName === candidate.name
    && location.latitude === candidate.latitude
    && location.longitude === candidate.longitude
    && location.elevation === candidate.elevation;
  // Disabled when the pick matches what's already in effect — nothing to apply.
  const changed = !!selected && !sameLocation(effective, selected);
  // Re-picking the untouched canonical location while a correction is pending
  // clears the correction rather than queuing a same-as-current no-op edit.
  const revertsToCanonical = sameLocation(canonicalCurrent, selected);

  const apply = async () => {
    if (!changed) return;
    if (revertsToCanonical || !selected) {
      await onApply(null);
      onClose();
      return;
    }
    const next = locationToDeployment(selected, collectionUuid);
    // Preserve the canonical row's `timestampIssues` flag — a location
    // correction shouldn't silently reset whether the camera supplied a
    // timestamp.
    await onApply({ ...next, timestampIssues: canonicalCurrent?.timestampIssues });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Change location"
    >
      <div
        className="w-full max-w-[560px] max-h-[90dvh] overflow-y-auto bg-paper border border-rule shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-5 py-3">
          <h2 className="font-display text-[18px] font-[600] text-ink">Change location · whole upload</h2>
          <button
            onClick={onClose}
            className="w-11 h-11 grid place-items-center md:w-7 md:h-7 border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="p-5">
          <p className="text-[13px] text-inkSoft font-body max-w-[500px] mb-4">
            Cameras occasionally get logged under the wrong location. This corrects the whole
            upload — every image shares the same location. Select the correct location below.
          </p>

          <span className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft">
            Current
          </span>
          <div className="mt-1 font-mono text-[13px] text-ink">
            {canonicalCurrent
              ? `${canonicalCurrent.locationName} (${canonicalCurrent.locationId})`
              : 'Unknown — no deployments.csv on file'}
          </div>
          {pending && (
            <div className="mt-1 font-mono text-[12px] text-accent">
              pending change → {pending.locationName} ({pending.locationId})
            </div>
          )}

          <span className="mt-4 block font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft">
            New location
          </span>
          <div className="mt-1">
            <LocationPicker
              locations={locations}
              value={selectedKey}
              onChange={setSelectedKey}
              distanceUnit={distanceUnit}
            />
          </div>

          {changed && (
            <div className="mt-4 border border-rule bg-panel px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft">
                  Preview
                </span>
                <span className="font-mono text-[11.5px] font-[600] text-accent">
                  {revertsToCanonical ? 'clears pending change' : 'location change'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr] items-center gap-3">
                <div>
                  <div className="text-[10px] font-[600] tracking-[0.12em] uppercase text-inkSoft mb-1">
                    Current
                  </div>
                  <div className="font-mono text-[14px] text-inkSoft line-through decoration-rule break-all">
                    {effective ? effective.locationName : '—'}
                  </div>
                </div>
                <div className="text-center font-mono text-[16px] text-accent">→</div>
                <div>
                  <div className="text-[10px] font-[600] tracking-[0.12em] uppercase text-accent mb-1">
                    New
                  </div>
                  <div className="font-mono text-[14px] font-[600] text-ink break-all">
                    {selected!.name}
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className="mt-3 font-mono text-[11.5px] text-inkSoft">
            <span className="text-inkMute">note</span> This only takes effect at the next sync —
            nothing is rewritten locally.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-rule px-5 py-3">
          {pending && (
            <button
              onClick={() => {
                void onApply(null).then(onClose);
              }}
              className="text-[13px] border border-rule px-3 py-1.5 text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              Clear pending change
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="text-[13px] border border-rule px-3 py-1.5 text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Cancel
          </button>
          <button
            onClick={apply}
            disabled={!changed}
            className="text-[13px] border border-ink bg-ink text-paper px-3 py-1.5 hover:bg-inkSoft disabled:opacity-40 disabled:hover:bg-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Apply to all {totalFrames.toLocaleString()} images →
          </button>
        </div>
      </div>
    </div>
  );
}
