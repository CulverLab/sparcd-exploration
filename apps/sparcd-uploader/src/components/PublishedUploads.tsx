// Edit-after-publish management surface (Stage B). Lists the published uploads
// of a collection and offers two guarded corrections per upload: edit the
// description, or re-point a misassigned deployment/location. Both go through
// `runPublishedEdit` — IfMatch-gated, snapshot-first, stale-ETag-is-a-conflict
// — and honor the global dry-run flag exactly as uploads do.

import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { parseCollectionKey } from '../lib/s3';
import { useCollections, usePublishedUploads } from '../lib/useCollections';
import { useLocations } from '../lib/useLocations';
import {
  loadPublishedCanonical,
  makeEditIO,
  readUploadMeta,
  type CollectionRef,
  type PublishedUpload,
} from '../lib/s3';
import {
  buildDescriptionEdit,
  restampDeployment,
  runPublishedEdit,
  type EditResult,
} from '../lib/publishedEdit';
import { locationToDeployment, type Location } from '../lib/locations';
import { javaEditStamp } from '@sparcd/camtrap';
import { formatUploadHeader } from '../lib/uploadDisplay';
import { DeploymentPicker } from './DeploymentPicker';
import { Note } from './RunMonitor';

const stampOf = (prefix: string) => prefix.replace(/\/$/, '').split('/').pop() ?? prefix;

function resultNote(result: EditResult, dryRun: boolean): { tone: 'mute' | 'warn'; message: string } {
  switch (result.status) {
    case 'noop':
      return { tone: 'mute', message: 'Nothing to change — the values already match.' };
    case 'dry-run':
      return {
        tone: 'mute',
        message: `Dry run — would replace ${result.writes
          .map((w) => stampOf(w.key))
          .join(', ')} (nothing written).`,
      };
    case 'edited':
      return { tone: 'mute', message: dryRun ? 'Applied.' : 'Applied. The published upload is updated.' };
    case 'conflict':
      return {
        tone: 'warn',
        message: `Conflict on ${result.role}: ${result.reason}. Reload and retry — nothing was written.`,
      };
    case 'unsupported':
      return { tone: 'warn', message: result.message };
  }
}

function UploadCard({
  collection,
  upload,
  locations,
  onApplied,
}: {
  collection: CollectionRef;
  upload: PublishedUpload;
  locations: Location[];
  onApplied: () => void;
}) {
  const cfg = useStore((s) => s.s3Config);
  const user = useStore((s) => s.uploaderUser);
  const dryRun = useStore((s) => s.dryRun);
  const elevationUnit = useStore((s) => s.elevationUnit);

  // UploadMeta.json is an unvalidated JSON cast (older/foreign files may drift),
  // so default the fields the display reads.
  const edits = Array.isArray(upload.meta.editComments) ? upload.meta.editComments : [];
  const [mode, setMode] = useState<'none' | 'description' | 'deployment'>('none');
  const [description, setDescription] = useState(upload.meta.description ?? '');
  const [locationKey, setLocationKey] = useState<string | null>(null);
  const [showEdits, setShowEdits] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'mute' | 'warn'; message: string } | null>(null);

  const { uuid } = parseCollectionKey(collection.key);

  async function saveDescription() {
    if (!cfg) return;
    setBusy(true);
    setNote(null);
    try {
      // Re-read fresh canonical to ground the IfMatch base on the current bytes.
      const fresh = await readUploadMeta(cfg, collection.bucket, upload.prefix);
      const body = buildDescriptionEdit(fresh.text, {
        description,
        user,
        editStamp: javaEditStamp(new Date()),
      });
      const result = await runPublishedEdit(
        {
          bucket: collection.bucket,
          uploadPrefix: upload.prefix,
          user,
          base: { uploadMeta: { etag: fresh.etag, hash: fresh.hash } },
          bodies: { uploadMeta: body },
          dryRun,
        },
        makeEditIO(cfg, collection.bucket, upload.prefix),
      );
      setNote(resultNote(result, dryRun));
      if (result.status === 'edited' && !dryRun) {
        setMode('none');
        onApplied();
      }
    } catch (err) {
      setNote({ tone: 'warn', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function saveDeployment() {
    if (!cfg) return;
    const loc = locations.find((l) => l.key === locationKey);
    if (!loc) return;
    setBusy(true);
    setNote(null);
    try {
      const roles = ['deployments', 'media', 'observations'] as const;
      const fresh = await loadPublishedCanonical(cfg, collection.bucket, upload.prefix, [...roles]);
      const deployment = locationToDeployment(loc, uuid);
      const next = restampDeployment(
        {
          deployments: fresh.deployments!.text,
          media: fresh.media!.text,
          observations: fresh.observations!.text,
        },
        { fromDeploymentId: upload.deploymentId ?? undefined, toDeploymentId: deployment.deploymentId, location: deployment },
      );
      const result = await runPublishedEdit(
        {
          bucket: collection.bucket,
          uploadPrefix: upload.prefix,
          user,
          base: {
            deployments: { etag: fresh.deployments!.etag, hash: fresh.deployments!.hash },
            media: { etag: fresh.media!.etag, hash: fresh.media!.hash },
            observations: { etag: fresh.observations!.etag, hash: fresh.observations!.hash },
          },
          bodies: { deployments: next.deployments, media: next.media, observations: next.observations },
          dryRun,
        },
        makeEditIO(cfg, collection.bucket, upload.prefix),
      );
      setNote(resultNote(result, dryRun));
      if (result.status === 'edited' && !dryRun) {
        setMode('none');
        onApplied();
      }
    } catch (err) {
      setNote({ tone: 'warn', message: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="border border-ruleSoft bg-panel px-4 py-3 space-y-2">
      <div className="min-w-0 space-y-0.5">
        <p className="font-display text-[14px] text-ink truncate" title={formatUploadHeader(upload.meta)}>
          {formatUploadHeader(upload.meta)}
        </p>
        <p className="font-body text-[12px] text-inkSoft">
          <span className="font-mono text-ink">{upload.meta.imagesWithSpecies ?? 0}</span>/
          <span className="font-mono text-ink">{upload.meta.imageCount ?? 0}</span> images tagged with
          species.
        </p>
        <p className="font-body text-[12px] text-inkSoft truncate" title={upload.meta.description}>
          {upload.meta.description || <span className="italic text-inkMute">no description</span>}
        </p>
        <p className="font-mono text-[11px] text-inkMute truncate" title={upload.prefix}>
          {upload.stamp}
        </p>
        {upload.deploymentId && (
          <p className="font-mono text-[11px] text-inkMute truncate" title={upload.deploymentId}>
            {upload.deploymentId}
          </p>
        )}
      </div>

      {edits.length > 0 && (
        <div>
          <button
            onClick={() => setShowEdits((v) => !v)}
            className="inline-flex min-h-[40px] items-center px-2 sm:min-h-0 sm:px-0 font-body text-[12px] text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-expanded={showEdits}
          >
            {showEdits ? '▾' : '▸'} {edits.length} edit{edits.length === 1 ? '' : 's'}
          </button>
          {showEdits && (
            <ul className="mt-1 font-mono text-[11px] text-inkSoft border-l border-ruleSoft pl-2 space-y-0.5 max-h-32 overflow-auto">
              {edits.map((c, i) => (
                <li key={i} className="truncate" title={c}>
                  {c}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === 'none' && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => {
              setMode('description');
              setDescription(upload.meta.description ?? '');
              setNote(null);
            }}
            className="border border-ink text-ink min-h-[44px] px-4 py-1 sm:min-h-0 sm:px-3 text-[13px] font-body hover:bg-paperHover"
          >
            Edit description
          </button>
          <button
            onClick={() => {
              setMode('deployment');
              setNote(null);
            }}
            className="border border-ink text-ink min-h-[44px] px-4 py-1 sm:min-h-0 sm:px-3 text-[13px] font-body hover:bg-paperHover"
          >
            Correct location
          </button>
        </div>
      )}

      {mode === 'description' && (
        <div className="space-y-2 pt-1">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full border border-rule bg-paper px-2.5 py-1.5 font-body text-[14px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
          />
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              disabled={busy}
              onClick={() => void saveDescription()}
              className="bg-ink text-paper border border-ink min-h-[44px] px-4 py-1 sm:min-h-0 sm:px-3 text-[13px] font-body font-[600] hover:opacity-90 disabled:opacity-40"
            >
              {busy ? 'Saving…' : dryRun ? 'Save (dry run)' : 'Save'}
            </button>
            <button
              disabled={busy}
              onClick={() => setMode('none')}
              className="border border-ink text-ink min-h-[44px] px-4 py-1 sm:min-h-0 sm:px-3 text-[13px] font-body hover:bg-paperHover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === 'deployment' && (
        <div className="space-y-2 pt-1">
          <DeploymentPicker
            locations={locations}
            value={locationKey}
            onChange={setLocationKey}
            elevationUnit={elevationUnit}
          />
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              disabled={busy || !locationKey}
              onClick={() => void saveDeployment()}
              className="bg-ink text-paper border border-ink min-h-[44px] px-4 py-1 sm:min-h-0 sm:px-3 text-[13px] font-body font-[600] hover:opacity-90 disabled:opacity-40"
            >
              {busy ? 'Saving…' : dryRun ? 'Re-stamp (dry run)' : 'Re-stamp'}
            </button>
            <button
              disabled={busy}
              onClick={() => setMode('none')}
              className="border border-ink text-ink min-h-[44px] px-4 py-1 sm:min-h-0 sm:px-3 text-[13px] font-body hover:bg-paperHover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {note && <Note tone={note.tone} message={note.message} />}
    </li>
  );
}

export function PublishedUploads() {
  const cfg = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);

  const [collectionKey, setCollectionKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const { data: collections } = useCollections(cfg, connectionId);
  const collection = useMemo(
    () => collections?.find((c) => c.key === collectionKey) ?? null,
    [collections, collectionKey],
  );
  const { data: uploads, isLoading, refetch } = usePublishedUploads(cfg, connectionId, collection);
  const { data: locationsData } = useLocations(cfg, connectionId);
  const locations = locationsData?.locations ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !uploads) return uploads ?? [];
    return uploads.filter(
      (u) =>
        u.stamp.toLowerCase().includes(q) ||
        (u.meta.uploadUser ?? '').toLowerCase().includes(q) ||
        (u.meta.description ?? '').toLowerCase().includes(q) ||
        (u.deploymentId ?? '').toLowerCase().includes(q),
    );
  }, [uploads, query]);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="font-display text-[16px] text-ink">Published uploads</p>
        <p className="font-body text-[12px] text-inkSoft">
          Correct a description or a misassigned deployment after publish.
        </p>
      </div>

      <select
        value={collectionKey ?? ''}
        onChange={(e) => setCollectionKey(e.target.value || null)}
        className="w-full border border-rule bg-paper px-2.5 py-2 font-body text-[14px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
      >
        <option value="">Select a collection…</option>
        {collections?.map((c) => (
          <option key={c.key} value={c.key}>
            {c.name ?? c.bucket}
          </option>
        ))}
      </select>

      {collection && uploads && uploads.length > 0 && (
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search uploads by uploader, description, stamp, or deployment…"
          className="w-full border border-rule bg-paper px-2.5 py-1.5 font-body text-[14px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
        />
      )}

      {collection && isLoading && <p className="font-body text-[13px] text-inkSoft">Loading uploads…</p>}
      {collection && uploads && uploads.length === 0 && (
        <Note message="No published uploads in this collection." />
      )}
      {collection && uploads && uploads.length > 0 && filtered.length === 0 && (
        <Note message="No uploads match your search." />
      )}
      {collection && uploads && uploads.length > 0 && filtered.length > 0 && (
        <ul className="space-y-3">
          {filtered.map((u) => (
            <UploadCard
              key={u.prefix}
              collection={collection}
              upload={u}
              locations={locations}
              onApplied={() => void refetch()}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
