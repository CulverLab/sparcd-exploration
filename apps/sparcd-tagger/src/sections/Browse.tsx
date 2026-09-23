import { useMemo, useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useStore } from '../store';
import {
  useCollections,
  useUploads,
  useSpecies,
  useUploadSummaries,
  useUploadDraftStates,
  type UploadSummary,
  type UploadDraftState,
} from '../lib/queries';

const kicker = 'font-body text-[11px] font-[600] tracking-[0.16em] uppercase text-inkSoft';

// Upload prefixes are stamped `YYYY.MM.DD.HH.MM.SS_user` (the user is the SPARC'd
// account that uploaded; older stamps may omit it). Split it so the list can show
// a real date column and surface who uploaded.
function parseStamp(stamp: string): { date: string; time: string; user: string | null } {
  const m = stamp.match(/^(\d{4})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})\.(\d{2})(?:_(.+))?$/);
  if (!m) return { date: stamp, time: '', user: null };
  const [, y, mo, d, hh, mm] = m;
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mm}`, user: m[7] ?? null };
}

type Tab = 'all' | 'in-progress' | 'done';

// Which filter tab an upload belongs to, from its canonical tally. Untouched and
// partial both read as in-progress; fully tagged is done. Undefined while the
// summary is still loading — those rows only show under "All".
function tabOf(s: UploadSummary | undefined): Tab | 'loading' {
  if (!s) return 'loading';
  return s.imageCount > 0 && s.imagesWithSpecies >= s.imageCount ? 'done' : 'in-progress';
}

// Browse is the entry point: pick a collection in the rail, then pick one of its
// uploads in the table — choosing an upload opens the Tag workspace.
export function Browse() {
  const cfg = useStore((s) => s.s3Config);
  const connectionId = useStore((s) => s.connectionId);
  const collectionKey = useStore((s) => s.selectedCollectionKey);
  const selectCollection = useStore((s) => s.selectCollection);
  const selectUpload = useStore((s) => s.selectUpload);

  const collections = useCollections(cfg, connectionId);
  const uploads = useUploads(cfg, connectionId, collectionKey);
  const species = useSpecies(cfg, connectionId, collectionKey); // loaded for the selected collection
  const summaries = useUploadSummaries(cfg, connectionId, collectionKey, uploads.data);
  const draftStates = useUploadDraftStates(connectionId, collectionKey);

  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<Tab>('all');

  const collection = collections.data?.find((c) => c.key === collectionKey);

  const shownCollections = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return collections.data ?? [];
    return (collections.data ?? []).filter((c) =>
      `${c.name ?? c.bucket} ${c.organization ?? ''}`.toLowerCase().includes(q),
    );
  }, [collections.data, filter]);

  // Running totals + tab counts over whatever summaries have resolved so far.
  const { images, tagged, counts, anyPending } = useMemo(() => {
    let images = 0;
    let tagged = 0;
    const counts = { 'in-progress': 0, done: 0 };
    let anyPending = false;
    for (const q of summaries) {
      if (q.isLoading) anyPending = true;
      const s = q.data;
      if (!s) continue;
      images += s.imageCount;
      tagged += s.imagesWithSpecies;
      const t = tabOf(s);
      if (t === 'in-progress' || t === 'done') counts[t] += 1;
    }
    return { images, tagged, counts, anyPending };
  }, [summaries]);

  const uploadCount = uploads.data?.length ?? 0;

  return (
    <div className="h-full grid grid-cols-1 xl:grid-cols-[320px_1fr] min-h-0">
      {/* Collection rail */}
      <aside className="border-r border-rule bg-panel flex flex-col min-h-0">
        <div className="p-4 border-b border-rule">
          <h2 className={kicker}>Collections</h2>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter collections"
            className="mt-2 w-full bg-paper border border-rule px-3 py-2 text-[14px] text-ink placeholder:text-inkMute focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          <Status q={collections} empty="No collections visible to these credentials." pad />
          {collections.isLoading && <RailSkeleton />}
          {!collections.isLoading && collections.data && shownCollections.length === 0 && filter && (
            <p className="text-[13px] text-inkMute px-4 py-3">No collections match “{filter}”.</p>
          )}
          <ul>
            {shownCollections.map((c) => (
              <li key={c.key}>
                <button
                  onClick={() => selectCollection(c.key)}
                  aria-current={c.key === collectionKey ? 'true' : undefined}
                  className={`w-full text-left px-4 py-3.5 border-b border-ruleSoft border-l-2 hover:bg-panelHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
                    c.key === collectionKey ? 'bg-mark border-l-accent' : 'border-l-transparent'
                  }`}
                >
                  <div className={`text-[14px] text-ink ${c.key === collectionKey ? 'font-[600]' : ''}`}>
                    {c.name ?? c.bucket}
                  </div>
                  {c.organization && (
                    <div className="text-[12px] text-inkSoft font-mono mt-1">{c.organization}</div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-[12px] text-inkMute font-body border-t border-rule p-4">
          {species.isLoading && 'Loading species vocabulary…'}
          {species.isError && `Species vocabulary unavailable: ${(species.error as Error).message}`}
          {species.data &&
            `${species.data.species.length} species loaded from ${species.data.sourceBucket}/${species.data.sourceKey}` +
              (species.data.skipped.length ? ` (${species.data.skipped.length} skipped)` : '')}
        </p>
      </aside>

      {/* Uploads for the chosen collection */}
      <div className="overflow-y-auto p-5">
        {!collectionKey && (
          <CollectionPrompt
            collectionCount={collections.data?.length}
            speciesCount={species.data?.species.length}
            loading={collections.isLoading}
          />
        )}
        {collectionKey && (
          <>
            <nav className="flex items-center gap-1.5 text-[13px] mb-3">
              <span className="text-inkSoft">Browse</span>
              <span className="text-inkMute">/</span>
              <span className="text-ink">{collection?.name ?? collection?.bucket ?? '…'}</span>
            </nav>

            <div className="flex items-baseline justify-between gap-4 flex-wrap mb-4">
              <div>
                <h1 className="font-display text-[28px] leading-tight text-ink">
                  Uploads in {collection?.name ?? collection?.bucket ?? 'this collection'}
                </h1>
                <p className="text-[13px] text-inkSoft mt-1">
                  {uploads.isLoading ? (
                    'Loading uploads…'
                  ) : (
                    <>
                      {uploadCount} upload{uploadCount === 1 ? '' : 's'}
                      <Dot />
                      {images.toLocaleString()} image{images === 1 ? '' : 's'}
                      <Dot />
                      {tagged.toLocaleString()} tagged
                      <Dot />
                      {Math.max(0, images - tagged).toLocaleString()} to go
                      {anyPending && <span className="text-inkMute"> · tallying…</span>}
                    </>
                  )}
                </p>
              </div>

              {uploadCount > 0 && (
                <div className="flex flex-wrap gap-2">
                  <TabButton
                    label="All"
                    n={uploadCount}
                    active={tab === 'all'}
                    onClick={() => setTab('all')}
                    title="Every upload in this collection"
                    descriptionId="browse-all-tab-description"
                  />
                  <TabButton
                    label="In progress"
                    n={counts['in-progress']}
                    active={tab === 'in-progress'}
                    onClick={() => setTab('in-progress')}
                    title="Uploads not yet fully tagged"
                    descriptionId="browse-in-progress-tab-description"
                  />
                  <TabButton
                    label="Done"
                    n={counts.done}
                    active={tab === 'done'}
                    onClick={() => setTab('done')}
                    title="Uploads that are fully tagged"
                    descriptionId="browse-done-tab-description"
                  />
                </div>
              )}
            </div>

            <Status q={uploads} empty="No uploads in this collection." />

            {!uploads.isError && uploadCount > 0 && (
              <div className="browse-upload-table bg-panel border border-rule">
                {/* Column header */}
                <div className={`hidden md:grid ${uploadGrid} gap-4 px-4 py-2.5 border-b border-rule text-[11px] font-[600] tracking-[0.14em] uppercase text-inkSoft`}>
                  <span data-column="date">Date</span>
                  <span data-column="upload">Upload</span>
                  <span data-column="deployment">Deployment</span>
                  <span data-column="images" className={`${imagesCell} text-right`}>Images</span>
                  <span data-column="tagged" className="md:hidden browse-md:block">Tagged</span>
                  <span data-column="sync" className={syncCell}>Sync</span>
                  <span />
                </div>

                {uploads.isLoading && <RowsSkeleton />}

                {uploads.data?.map((u, i) => {
                  const t = tabOf(summaries[i]?.data);
                  if (tab !== 'all' && t !== tab) return null;
                  return (
                    <UploadRow
                      key={u.prefix}
                      stamp={u.stamp}
                      query={summaries[i]}
                      draftState={draftStates.data?.get(u.prefix)}
                      onOpen={() => selectUpload(u.prefix)}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Column tracks for the upload table, shared by the header and every row so the
// two cannot drift. `browse-sm/md/lg` are the table's own container size steps
// (defined in tailwind.config.ts): each adds the column whose track it just
// made room for. Below `md` the row stacks into a single column and every cell
// shows, which is why each supporting cell hides at `md` before its step
// restores it.
const uploadGrid =
  'grid-cols-[1fr] md:grid-cols-[120px_minmax(16rem,1fr)_160px_70px] ' +
  'browse-sm:grid-cols-[120px_minmax(16rem,1fr)_160px_140px_70px] ' +
  'browse-md:grid-cols-[120px_minmax(16rem,1fr)_160px_minmax(0,1.2fr)_140px_70px] ' +
  'browse-lg:grid-cols-[120px_minmax(16rem,1fr)_160px_70px_minmax(0,1.2fr)_140px_70px]';

const syncCell = 'md:hidden browse-sm:block';
const imagesCell = 'md:hidden browse-lg:block';

function UploadRow({
  stamp,
  query,
  draftState,
  onOpen,
}: {
  stamp: string;
  query: UseQueryResult<UploadSummary> | undefined;
  draftState: UploadDraftState | undefined;
  onOpen: () => void;
}) {
  const { date, time, user } = parseStamp(stamp);
  const s = query?.data;
  const loading = query?.isLoading ?? true;
  const pct = s && s.imageCount > 0 ? Math.round((s.imagesWithSpecies / s.imageCount) * 100) : 0;

  return (
    <button
      onClick={onOpen}
      className={`w-full text-left grid ${uploadGrid} gap-2 md:gap-4 items-center px-4 py-3 border-b border-ruleSoft border-l-2 border-l-transparent hover:bg-panelHover hover:border-l-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent group`}
    >
      <span data-column="date" className="font-mono text-[12.5px] text-inkSoft">{date}</span>

      <span data-column="upload" className="min-w-0">
        <span className="block font-mono text-[13px] text-ink truncate">{user ?? stamp}</span>
        {time && <span className="block font-mono text-[11px] text-inkMute">{time}</span>}
      </span>

      <span data-column="deployment" className="font-mono text-[13px] text-inkSoft truncate">
        {loading ? <Skeleton w="w-24" /> : s?.deployments.length ? s.deployments.join(', ') : '—'}
      </span>

      <span data-column="images" className={`${imagesCell} font-mono text-[13px] text-ink text-right`}>
        {loading ? <Skeleton w="w-12" /> : query?.isError ? '—' : s!.imageCount.toLocaleString()}
      </span>

      <span data-column="tagged" className="flex md:hidden browse-md:flex items-center gap-2.5">
        {loading || query?.isError || !s ? (
          <Skeleton w="w-full" />
        ) : (
          <>
            <span className="flex-1 h-1.5 bg-ruleSoft relative">
              <span className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
            </span>
            <span className="font-mono text-[12px] text-inkSoft min-w-[72px] text-right">
              <span className="text-ink">{s.imagesWithSpecies.toLocaleString()}</span> / {s.imageCount.toLocaleString()}
            </span>
          </>
        )}
      </span>

      <span data-column="sync" className={syncCell}>
        <SyncPill state={draftState ?? 'local-only'} />
      </span>

      <span className="text-right text-accent font-[600] text-[13px] opacity-70 group-hover:opacity-100">
        Open →
      </span>
    </button>
  );
}

// Notched status pills, distinct by shape + glyph (not color alone). Browse only
// produces the three states derivable from local drafts; conflict/error surface
// at sync time in the Tag workspace.
function SyncPill({ state }: { state: UploadDraftState | 'local-only' }) {
  if (state === 'local-only') {
    return (
      <span className="inline-flex items-center gap-1.5 border border-rule px-3 h-7 text-[12px] font-body font-[600] text-inkSoft lowercase">
        <span className="font-mono" aria-hidden>
          ○
        </span>
        local-only
      </span>
    );
  }
  const spec =
    state === 'unsynced'
      ? { bg: 'bg-accent', glyph: '●', label: 'unsynced edits', clip: 'polygon(0 0, calc(100% - 9px) 0, 100% 50%, calc(100% - 9px) 100%, 0 100%)' }
      : { bg: 'bg-ok', glyph: '✓', label: 'synced', clip: 'polygon(9px 0, 100% 0, 100% 100%, 9px 100%, 0 50%)' };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3.5 h-7 text-[12px] font-body font-[600] text-paper lowercase ${spec.bg}`}
      style={{ clipPath: spec.clip }}
    >
      <span className="font-mono" aria-hidden>
        {spec.glyph}
      </span>
      {spec.label}
    </span>
  );
}

function TabButton({
  label,
  n,
  active,
  onClick,
  title,
  descriptionId,
}: {
  label: string;
  n: number;
  active: boolean;
  onClick: () => void;
  title: string;
  descriptionId: string;
}) {
  return (
    <>
      <button
        onClick={onClick}
        aria-pressed={active}
        aria-describedby={descriptionId}
        title={title}
        className={`px-3 min-h-11 py-2.5 sm:min-h-0 sm:py-1.5 text-[13px] border focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
          active ? 'bg-ink text-paper border-ink font-[600]' : 'bg-panel text-inkSoft border-rule hover:bg-panelHover'
        }`}
      >
        {label} <span className="font-mono text-[11px] opacity-70 ml-1">{n}</span>
      </button>
      <span id={descriptionId} className="sr-only">{title}</span>
    </>
  );
}

function Dot() {
  return (
    <span className="text-ruleSoft mx-1.5" aria-hidden>
      ·
    </span>
  );
}

function Skeleton({ w }: { w: string }) {
  return <span className={`inline-block h-3 ${w} bg-ruleSoft/70 animate-pulse align-middle`} />;
}

function RailSkeleton() {
  return (
    <div className="px-4 py-3 space-y-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3.5 w-3/4 bg-ruleSoft/70 animate-pulse" />
          <div className="h-2.5 w-1/2 bg-ruleSoft/50 animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function RowsSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="px-4 py-3 border-b border-ruleSoft flex items-center gap-4">
          <div className="h-3 w-16 bg-ruleSoft/60 animate-pulse" />
          <div className="h-3 flex-1 bg-ruleSoft/50 animate-pulse" />
          <div className="h-3 w-20 bg-ruleSoft/40 animate-pulse" />
        </div>
      ))}
    </>
  );
}

function Status({
  q,
  empty,
  pad,
}: {
  q: { isLoading: boolean; isError: boolean; error?: unknown; data?: unknown[] };
  empty: string;
  pad?: boolean;
}) {
  const m = pad ? 'px-4 py-3' : 'mt-2';
  if (q.isLoading) return null;
  if (q.isError) return <p className={`text-[13px] text-warn ${m}`}>{(q.error as Error).message}</p>;
  if (Array.isArray(q.data) && q.data.length === 0)
    return <p className={`text-[13px] text-inkMute ${m}`}>{empty}</p>;
  return null;
}

// The first-run canvas. Instead of an empty void, a field-journal frontispiece:
// a stamped track (camera traps fire on what walks past — here, a wildcat's paw)
// ringed by idle motion-detection pulses, with a cue pointing back to the rail.
function CollectionPrompt({
  collectionCount,
  speciesCount,
  loading,
}: {
  collectionCount?: number;
  speciesCount?: number;
  loading: boolean;
}) {
  return (
    <div className="relative h-full grid place-items-center px-6">
      {/* Anchored to the panel edge, nudging the eye toward the collection rail. */}
      <div
        className="fn-rise absolute left-1 top-1/2 -translate-y-1/2 hidden xl:flex items-center gap-2 text-inkMute"
        style={{ animationDelay: '0.5s' }}
      >
        <span className="fn-nudge text-accent" aria-hidden>
          <svg width="34" height="14" viewBox="0 0 34 14" fill="none">
            <path
              d="M33 7H2M2 7l5-5M2 7l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] [writing-mode:vertical-rl] rotate-180">
          Start here
        </span>
      </div>

      <div className="max-w-[420px] text-center">
        <div className="fn-rise mx-auto mb-7 grid place-items-center" style={{ animationDelay: '0.05s' }}>
          <PawStamp />
        </div>

        <p className={`fn-rise ${kicker} block`} style={{ animationDelay: '0.15s' }}>
          Field Notebook · Tagger
        </p>

        <h1
          className="fn-rise font-display text-[27px] leading-tight text-ink mt-2 text-balance"
          style={{ animationDelay: '0.25s' }}
        >
          Pick up a collection to begin
        </h1>

        <p
          className="fn-rise font-body text-[14px] leading-relaxed text-inkSoft mt-3 mx-auto max-w-[34ch] text-pretty"
          style={{ animationDelay: '0.35s' }}
        >
          Choose one from the rail on the left to see its uploads — then open an
          upload to start tagging what the cameras caught.
        </p>

        <div
          className="fn-rise mt-7 inline-flex items-center gap-3 border-t border-ruleSoft pt-3 font-mono text-[12px] text-inkMute"
          style={{ animationDelay: '0.45s' }}
        >
          {loading ? (
            'Loading collections…'
          ) : (
            <>
              <span className="text-inkSoft">{collectionCount ?? 0}</span> collections in view
              {speciesCount != null && (
                <>
                  <span className="text-ruleSoft" aria-hidden>
                    ·
                  </span>
                  <span className="text-inkSoft">{speciesCount}</span> species ready
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// A pressed wildcat track ringed by idle motion-sensor pulses.
function PawStamp() {
  return (
    <svg width="108" height="108" viewBox="0 0 108 108" fill="none" aria-hidden role="img">
      {[0, 1.05, 2.1].map((delay, i) => (
        <circle
          key={i}
          className="fn-scan"
          cx="54"
          cy="54"
          r="30"
          stroke="var(--accent)"
          strokeWidth="1"
          fill="none"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
      <g fill="var(--ink)" opacity="0.9">
        {/* metacarpal pad */}
        <path d="M54 86c-12 0-19-7-19-15 0-7 8-11 19-11s19 4 19 11c0 8-7 15-19 15Z" />
        {/* toe pads */}
        <ellipse cx="33" cy="49" rx="6" ry="8" transform="rotate(-18 33 49)" />
        <ellipse cx="46" cy="38" rx="6" ry="9" transform="rotate(-6 46 38)" />
        <ellipse cx="62" cy="38" rx="6" ry="9" transform="rotate(6 62 38)" />
        <ellipse cx="75" cy="49" rx="6" ry="8" transform="rotate(18 75 49)" />
      </g>
    </svg>
  );
}
