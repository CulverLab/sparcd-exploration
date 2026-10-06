import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../store';
import { useDraftStore } from '../lib/drafts';
import { useCollections, useCollectionSnapshots } from '../lib/queries';
import { listDirtyDrafts, type DraftRecord } from '../lib/db';

// History section. Two recovery surfaces, both read-only here:
//   1. Unsynced local edits — uploads with dirty drafts in this browser's
//      IndexedDB, so a closed/reopened tab can jump back to its work or discard.
//   2. Synced snapshots — the cross-upload browser of immutable pre-change
//      snapshots written before each S3 sync. Listing is read-only; the actual
//      restore needs the upload's bucket/prefix/identity context, so picking one
//      routes into the Tag workspace and opens its "Snapshots…" dialog (the P5
//      conditional-replacement restore flow).

const kicker = 'font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft';

type Group = {
  bucket: string;
  uploadPrefix: string;
  collectionKey: string; // `${bucket}::${uuid}` — what the store/Tag workspace key on
  stamp: string;
  count: number; // dirty drafts
  taggedCount: number; // dirty drafts carrying a species/label
  lastEdited: string;
};

// uploadPrefix is `Collections/<uuid>/Uploads/<stamp>/`.
function uuidOf(uploadPrefix: string): string {
  return /Collections\/([^/]+)\/Uploads\//.exec(uploadPrefix)?.[1] ?? '';
}
function stampOf(uploadPrefix: string): string {
  return uploadPrefix.replace(/\/$/, '').split('/').pop() ?? uploadPrefix;
}

function groupDirty(rows: DraftRecord[]): Group[] {
  const byUpload = new Map<string, Group>();
  for (const r of rows) {
    const id = `${r.bucket}::${r.uploadPrefix}`;
    let g = byUpload.get(id);
    if (!g) {
      g = {
        bucket: r.bucket,
        uploadPrefix: r.uploadPrefix,
        collectionKey: `${r.bucket}::${uuidOf(r.uploadPrefix)}`,
        stamp: stampOf(r.uploadPrefix),
        count: 0,
        taggedCount: 0,
        lastEdited: '',
      };
      byUpload.set(id, g);
    }
    g.count++;
    if (r.observations.length) g.taggedCount++;
    if (r.lastEdited > g.lastEdited) g.lastEdited = r.lastEdited;
  }
  return [...byUpload.values()].sort((a, b) => b.lastEdited.localeCompare(a.lastEdited));
}

export function Recovery() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-[760px] mx-auto space-y-10">
        <header>
          <h1 className="font-display text-[22px] text-ink">History</h1>
          <p className="text-[13px] text-inkSoft font-body mt-1">
            Recover unsaved local edits or restore a prior synced snapshot of an upload.
          </p>
        </header>

        <LocalEdits />
        <Snapshots />
      </div>
    </div>
  );
}

// --- Unsynced local edits ----------------------------------------------------

function LocalEdits() {
  const cfg = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const collections = useCollections(cfg, connectionId);
  const selectCollection = useStore((s) => s.selectCollection);
  const selectUpload = useStore((s) => s.selectUpload);
  const discardUpload = useDraftStore((s) => s.discardUpload);
  // Re-derive whenever the in-memory drafts change (a fresh edit/discard while
  // the History tab is open should refresh the list).
  const liveDrafts = useDraftStore((s) => s.drafts);

  const [groups, setGroups] = useState<Group[] | null>(null);

  const refresh = useCallback(async () => {
    setGroups(groupDirty(await listDirtyDrafts()));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, liveDrafts]);

  const open = (g: Group) => {
    // A collection is keyed by its home bucket, which need not be the bucket
    // this upload lives in once it spans a data bucket and its legacy one.
    const uuid = uuidOf(g.uploadPrefix);
    selectCollection(collections.data?.find((c) => c.uuid === uuid)?.key ?? g.collectionKey); // resets upload selection
    selectUpload(g.uploadPrefix, g.bucket); // sets section → 'tag'
  };

  const discard = async (g: Group) => {
    if (!confirm(`Discard ${g.count} unsaved local edit(s) for ${g.stamp}?`)) return;
    await discardUpload({ bucket: g.bucket, uploadPrefix: g.uploadPrefix });
    await refresh();
  };

  return (
    <section className="space-y-3">
      <div>
        <h2 className={kicker}>Unsynced local edits</h2>
        <p className="text-[12px] text-inkMute font-body mt-1">
          Uploads with unsaved edits kept in this browser. Reopen one to keep tagging or discard its
          local changes.
        </p>
      </div>

      {groups === null && <p className="text-[13px] text-inkMute font-body">Scanning local drafts…</p>}

      {groups && groups.length === 0 && (
        <p className="text-[14px] text-inkMute font-body border border-ruleSoft bg-panel px-4 py-6 text-center">
          No unsaved local edits. Everything here is clean.
        </p>
      )}

      {groups && groups.length > 0 && (
        <ul className="space-y-2">
          {groups.map((g) => (
            <li
              key={`${g.bucket}::${g.uploadPrefix}`}
              className="border border-rule bg-panel px-4 py-3 flex flex-col items-stretch sm:flex-row sm:items-center gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[14px] text-ink truncate" title={g.uploadPrefix}>
                  {g.stamp}
                </div>
                <div className="font-mono text-[12px] text-inkMute truncate" title={g.bucket}>
                  {g.bucket}
                </div>
                <div className="text-[12px] text-inkSoft font-body mt-0.5">
                  {g.count} unsaved · {g.taggedCount} tagged · edited {shortTime(g.lastEdited)}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                <button onClick={() => open(g)} className={`${btnInk} flex-1 sm:flex-none`}>
                  Open →
                </button>
                <button
                  onClick={() => void discard(g)}
                  className="flex-1 sm:flex-none text-[13px] border border-rule px-3 py-1.5 text-inkSoft hover:text-warn hover:border-warn focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Synced snapshots (cross-upload) -----------------------------------------

function Snapshots() {
  const cfg = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const selectedCollectionKey = useStore((s) => s.selectedCollectionKey);
  const openForSnapshots = useStore((s) => s.openUploadForSnapshots);

  const collections = useCollections(cfg, connectionId);
  // Default the scope to whatever the user last drilled into; otherwise the
  // first discovered collection once they load.
  const [scope, setScope] = useState<string | null>(selectedCollectionKey);
  const scopeKey = scope ?? selectedCollectionKey ?? collections.data?.[0]?.key ?? null;

  const snaps = useCollectionSnapshots(cfg, connectionId, collections.data?.find((c) => c.key === scopeKey));

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className={kicker}>Synced snapshots</h2>
          <p className="text-[12px] text-inkMute font-body mt-1">
            Immutable pre-change snapshots written before each sync. Pick one to open the upload and
            restore it.
          </p>
        </div>
        {collections.data && collections.data.length > 0 && (
          <select
            value={scopeKey ?? ''}
            onChange={(e) => setScope(e.target.value)}
            className="bg-paper border border-rule px-2.5 py-1.5 text-[13px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {collections.data.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name ?? c.bucket}
              </option>
            ))}
          </select>
        )}
      </div>

      {!scopeKey && !collections.isLoading && (
        <p className="text-[13px] text-inkMute font-body">No collections visible to these credentials.</p>
      )}
      {(collections.isLoading || (scopeKey && snaps.isLoading)) && (
        <p className="text-[13px] text-inkMute font-body">Listing snapshots…</p>
      )}
      {snaps.isError && (
        <p className="text-[13px] text-warn font-body border border-warn px-3 py-2">
          {(snaps.error as Error).message}
        </p>
      )}

      {snaps.data && snaps.data.length === 0 && (
        <p className="text-[14px] text-inkMute font-body border border-ruleSoft bg-panel px-4 py-6 text-center">
          No snapshots in this collection yet. They are created the first time you sync an upload.
        </p>
      )}

      {snaps.data && snaps.data.length > 0 && (
        <ul className="space-y-4">
          {snaps.data.map((u) => (
            <li key={u.uploadPrefix} className="border border-rule bg-panel">
              <div className="flex items-center justify-between gap-4 border-b border-ruleSoft px-4 py-2.5">
                <div className="min-w-0">
                  <div className="font-mono text-[14px] text-ink truncate" title={u.uploadPrefix}>
                    {u.uploadStamp}
                  </div>
                  <div className="text-[12px] text-inkSoft font-body">
                    {u.snapshots.length} snapshot{u.snapshots.length === 1 ? '' : 's'}
                  </div>
                </div>
                <button
                  onClick={() => openForSnapshots(scopeKey!, u.uploadPrefix, u.bucket)}
                  className={`${btnInk} shrink-0`}
                  title="Open this upload and choose a snapshot to restore"
                >
                  Restore… →
                </button>
              </div>
              <ul className="divide-y divide-ruleSoft">
                {u.snapshots.map((s) => (
                  <li
                    key={s.prefix}
                    className="px-4 py-2 flex flex-wrap items-center gap-3 text-[12px] font-body"
                  >
                    <span className="font-mono text-[13px] text-ink">{prettyStamp(s.stamp)}</span>
                    <span className="text-inkSoft min-w-0 truncate">
                      by <span className="font-mono">{s.user}</span>
                    </span>
                    <span className="text-inkMute ml-auto">{s.manifest.files.length} files</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const btnInk =
  'text-[13px] border border-ink px-3 py-1.5 text-ink hover:bg-panelHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

function shortTime(iso: string): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '');
}

// Snapshot stamp is `uuuu-MM-ddTHH-mm-ss`; show it as `uuuu-MM-dd HH:MM:SS`.
function prettyStamp(stamp: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(stamp);
  return m ? `${m[1]} ${m[2]}:${m[3]}:${m[4]}` : stamp;
}
