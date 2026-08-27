import { useMediaUrl } from '../lib/useMediaUrl';
import { isVideoKey } from '../lib/workspace';

// One presigned-GET thumbnail. The URL is signed lazily (per connection +
// object key) and rendered straight into <img> — no canvas, so no CORS taint.
// Camera-trap originals are 1–5MB; P0 renders the original to prove the read
// path end-to-end, and the virtualized/progressive grid lands in P1+.
//
// Video media (`.mp4`) renders the same presigned URL into a poster-only
// <video> — `preload="metadata"`, no controls/autoplay — so the browser paints
// the first frame as the still without downloading the whole clip. `isVideo`
// defaults from the key so existing call sites stay one-arg.
export function Thumb({
  objectKey,
  alt,
  isVideo = isVideoKey(objectKey),
}: {
  objectKey: string;
  alt: string;
  isVideo?: boolean;
}) {
  const { url, isError } = useMediaUrl(objectKey);

  if (isError) {
    return (
      <div className="aspect-[4/3] bg-paperHover border border-rule grid place-items-center text-[11px] font-mono text-warn">
        failed
      </div>
    );
  }
  return (
    <div className="relative aspect-[4/3] bg-paperHover border border-rule overflow-hidden">
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
              className="w-full h-full object-cover"
            />
            <span
              aria-hidden
              className="absolute inset-0 grid place-items-center text-paper/90 text-lg drop-shadow"
            >
              ▶
            </span>
          </>
        ) : (
          <img src={url} alt={alt} loading="lazy" className="w-full h-full object-cover" />
        ))}
    </div>
  );
}
