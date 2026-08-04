import { useEffect, useMemo, useState } from 'react';
import { buildBundle, type BundlePreview } from '../lib/bundle';
import { formatBytes } from '../lib/scanFiles';
import type { Location } from '../lib/locations';
import type { FileEntry } from '../store';

type Tab = { key: keyof Pick<
  BundlePreview,
  'uploadMetaJson' | 'deploymentsCsv' | 'mediaCsv' | 'observationsCsv' | 'uploadCompleteJson'
>; label: string };

const TABS: Tab[] = [
  { key: 'uploadMetaJson', label: 'UploadMeta.json' },
  { key: 'deploymentsCsv', label: 'deployments.csv' },
  { key: 'mediaCsv', label: 'media.csv' },
  { key: 'observationsCsv', label: 'observations.csv' },
  { key: 'uploadCompleteJson', label: 'UploadComplete.json' },
];

export function MetadataPreview({
  location,
  collectionUuid,
  bucket,
  uploaderSlug,
  description,
  timeZone,
  files,
}: {
  location: Location;
  collectionUuid: string;
  bucket: string;
  uploaderSlug: string;
  description: string;
  timeZone: string;
  files: FileEntry[];
}) {
  const [bundle, setBundle] = useState<BundlePreview | null>(null);
  const [active, setActive] = useState<Tab['key']>('uploadMetaJson');

  // A stable signature of the inputs that affect the bundle. The prefix
  // timestamp is stamped once per rebuild; P4 stamps the real one at upload.
  const sig = useMemo(
    () =>
      [
        location.key,
        collectionUuid,
        bucket,
        uploaderSlug,
        description,
        timeZone,
        files.map((f) => `${f.id}:${f.sha256 ?? ''}`).join('|'),
      ].join(''),
    [location.key, collectionUuid, bucket, uploaderSlug, description, timeZone, files],
  );

  useEffect(() => {
    let stale = false;
    buildBundle({
      location,
      collectionUuid,
      bucket,
      uploaderSlug,
      description,
      timeZone,
      files,
      now: new Date(),
    }).then((b) => {
      if (!stale) setBundle(b);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (!bundle) {
    return (
      <div className="border border-ruleSoft bg-panel px-4 py-4 font-body text-[13px] text-inkSoft">
        Building preview…
      </div>
    );
  }

  const content = bundle[active];
  const empty = content.length === 0;

  return (
    <div className="border border-ruleSoft bg-panel">
      <div className="px-4 py-3 border-b border-ruleSoft">
        <p className="font-body text-[13px] text-inkSoft">
          {bundle.fileCount} file{bundle.fileCount === 1 ? '' : 's'} ·{' '}
          {formatBytes(bundle.totalBytes)} · landing under{' '}
          <span className="font-mono text-ink break-all">{bundle.uploadPath}/</span>
        </p>
        <p className="font-body text-[12px] text-inkMute mt-1">
          Image bytes upload under this prefix; each <span className="font-mono">media_path</span>{' '}
          points there (verified against the existing reader). Bundle hash{' '}
          <span className="font-mono text-inkSoft break-all">
            {bundle.metadataBundleSha256.slice(0, 16)}…
          </span>
          . Capture times in <span className="font-mono">media.csv</span> are interpreted in{' '}
          <span className="font-mono text-inkSoft">{timeZone}</span> (DST-aware). The prefix
          timestamp is stamped at upload.
        </p>
      </div>

      <div className="flex flex-wrap gap-0 border-b border-ruleSoft">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`min-h-[44px] sm:min-h-0 px-3 py-2.5 sm:py-2 font-mono text-[12px] border-r border-ruleSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2 ${
              active === t.key
                ? 'bg-paper text-ink font-[600]'
                : 'text-inkSoft hover:bg-paperHover'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-3">
        {empty ? (
          <p className="font-body text-[13px] text-inkMute italic">
            Empty file — no files in this upload yet.
          </p>
        ) : (
          <pre className="font-mono text-[11.5px] leading-[1.5] text-ink overflow-auto max-h-none md:max-h-[320px] overscroll-contain whitespace-pre-wrap break-all">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}
