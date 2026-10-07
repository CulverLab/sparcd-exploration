import { useState } from 'react';
import { useMediaUrl, type MediaPriority } from '../lib/useMediaUrl';
import { isVideoKey } from '../lib/workspace';
import { PawPads } from './Paw';

// One presigned-GET thumbnail. The URL is signed lazily (per connection +
// object key) and rendered straight into <img> — no canvas, so no CORS taint.
// Camera-trap originals are 1–5MB; P0 renders the original to prove the read
// path end-to-end, and the virtualized/progressive grid lands in P1+.
//
// Video media (`.mp4`) renders the same presigned URL into a poster-only
// <video> — `preload="metadata"`, no controls/autoplay — so the browser paints
// the first frame as the still without downloading the whole clip. `isVideo`
// defaults from the key so existing call sites stay one-arg.
export const THUMB_MEDIA_PRIORITY: MediaPriority = 'low';

export type ThumbnailLoadState = 'loading' | 'loaded' | 'failed';

export function thumbnailLoadState(
  mediaKey: string | undefined,
  loadedKey: string | undefined,
  failedKey: string | undefined,
): ThumbnailLoadState {
  if (mediaKey && failedKey === mediaKey) return 'failed';
  if (mediaKey && loadedKey === mediaKey) return 'loaded';
  return 'loading';
}

export function Thumb({
  objectKey,
  alt,
  isVideo = isVideoKey(objectKey),
}: {
  objectKey: string;
  alt: string;
  isVideo?: boolean;
}) {
  // Never 'high', even when selected: the scheduler keeps that slot for Focus.
  const { url, isError, markLoaded } = useMediaUrl(objectKey, THUMB_MEDIA_PRIORITY);
  // Keyed by image, not URL: a local thumbnail giving way to the original must
  // not blank a photo that is already showing.
  const mediaKey = url ? `${objectKey}\u0000${url}` : undefined;
  const [loadedKey, setLoadedKey] = useState<string>();
  const [failedKey, setFailedKey] = useState<string>();
  const loadState = thumbnailLoadState(mediaKey, loadedKey, failedKey);
  const loaded = loadState === 'loaded';
  const failed = loadState === 'failed';
  const onLoaded = () => {
    markLoaded();
    if (mediaKey) setLoadedKey(mediaKey);
  };
  const onError = () => {
    // A signed URL can succeed while the actual media GET fails. Release the
    // scheduler slot, but keep the tile visibly failed instead of treating it
    // as a successful load.
    markLoaded();
    if (mediaKey) setFailedKey(mediaKey);
  };

  if (isError || failed) {
    return (
      <div className="aspect-[4/3] bg-paperHover border border-rule grid place-items-center text-[11px] font-mono text-warn">
        <span data-testid="thumbnail-failure">failed</span>
      </div>
    );
  }
  const media = `absolute inset-0 w-full h-full object-cover transition-opacity duration-150 motion-reduce:transition-none ${
    loaded ? 'opacity-100' : 'opacity-0'
  }`;
  // A faint paw while the thumbnail waits for a download slot; it breathes once
  // the bytes are on their way, and the photo fades in over it.
  return (
    <div className="relative aspect-[4/3] bg-paperHover border border-rule overflow-hidden">
      <svg
        viewBox="25 28 58 59"
        fill="var(--ink)"
        aria-hidden
        className={`absolute inset-0 m-auto w-[44%] h-[44%] max-w-7 max-h-7 ${url && !loaded ? 'fn-breathe' : 'opacity-25'}`}
      >
        <PawPads />
      </svg>
      {url &&
        (isVideo ? (
          <>
            <video
              src={url}
              muted
              playsInline
              preload="metadata"
              // `preload="metadata"` paints the duration but not always a frame
              // (Safari / some mobile show black). Nudging currentTime forces the
              // browser to decode and display the first frame as the poster.
              onLoadedMetadata={(e) => {
                e.currentTarget.currentTime = 0.001;
              }}
              onLoadedData={onLoaded}
              onError={onError}
              className={media}
            />
            {loaded && (
              <span
                aria-hidden
                data-testid="thumbnail-play"
                className="absolute inset-0 grid place-items-center text-paper/90 text-lg drop-shadow"
              >
                ▶
              </span>
            )}
          </>
        ) : (
          <img
            src={url}
            alt={alt}
            loading="lazy"
            fetchPriority="low"
            onLoad={onLoaded}
            onError={onError}
            className={media}
          />
        ))}
    </div>
  );
}
