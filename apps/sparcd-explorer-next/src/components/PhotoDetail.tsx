import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { formatTimestamp24, type Model } from '@/data';
import { fmtN, formatElevation, formatPosition } from '@/lib/format';
import { photoKey, usePresigned, useThumb } from '@/lib/thumbs';
import { useStore } from '@/store';

const FOCUSABLE = 'button:not([disabled]), a[href], video, [tabindex]:not([tabindex="-1"])';

/**
 * One photo over the page, which stays where it was underneath. Prev and next
 * (and ← →) walk the photos in view in their current order; Close or Esc hands
 * focus back to what opened it.
 */
export function PhotoDetail({
  model,
  order,
  index,
  onIndex,
  onClose,
}: {
  model: Model;
  order: number[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const display = useStore((s) => s.display);
  const card = useRef<HTMLDivElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const i = order[index];
  const photo = model.photos[i];
  const site = model.sites[photo.site];
  const upload = model.uploads[photo.upload];
  const key = photoKey(model, i);
  // The thumbnail shows at once, ahead of every grid tile; the original replaces it once it arrives.
  const { thumb } = useThumb(photo.video ? null : key, -1);
  const full = usePresigned(key);
  const [loaded, setLoaded] = useState<string | null>(null);

  const step = (d: number) => onIndex((index + d + order.length) % order.length);
  const stepRef = useRef(step);
  stepRef.current = step;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // The page keeps its place but doesn't scroll behind the panel.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const before = html.style.overflow;
    html.style.overflow = 'hidden';
    next.current?.focus();
    return () => {
      html.style.overflow = before;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
      else if (e.key === 'ArrowLeft' && !(e.target instanceof HTMLVideoElement)) stepRef.current(-1);
      else if (e.key === 'ArrowRight' && !(e.target instanceof HTMLVideoElement)) stepRef.current(1);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  // Tab stays inside the panel.
  const trap = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = [...card.current!.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const tags = photo.detections.map((d) => model.detections[d]);
  const species = [...new Set(tags.map((t) => t.species))].map((s) => model.species[s]);
  const fields: [string, string][] = [
    ['Date and time', formatTimestamp24(photo.timestamp) || '—'],
    ['Count', tags.length ? tags.map((t) => `${fmtN(t.count)} ${model.species[t.species].name}`).join(', ') : '—'],
    ['Collection', model.collections[photo.collection].name],
    ['Location', site.noLocation ? 'No location set' : site.name || '—'],
    ['Location ID', site.locationId || '—'],
    ['Mountain range', site.range || '—'],
    ['Coordinates', formatPosition(site.position, display)],
    ['Elevation', formatElevation(site.elevation, display.elevation)],
    ['Comments', photo.comments || '—'],
    ['Upload', upload.user ? `${upload.stamp} · ${upload.user}` : upload.stamp],
    ['File name', photo.fileName],
    ['Media type', photo.mimeType || '—'],
  ];

  return createPortal(
    <div
      className="detail"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div ref={card} className="detail-card" onKeyDown={trap}>
        <div className="detail-img" data-photo={i}>
          {photo.video ? (
            full && <video key={full} src={full} controls preload="metadata" aria-label={`Video ${photo.fileName}`} />
          ) : (
            <>
              {thumb && <img className="under" src={thumb.url} alt="" />}
              {full && (
                <img
                  key={full}
                  className={loaded === full ? 'full on' : 'full'}
                  src={full}
                  alt={`Photo ${photo.fileName}`}
                  onLoad={() => setLoaded(full)}
                />
              )}
            </>
          )}
          {photo.video && <span className="badge play">Video</span>}
        </div>
        <div className="detail-side">
          <div className="detail-nav">
            <button type="button" className="btn sm" aria-label="Previous photo" onClick={() => step(-1)}>
              ‹ Prev
            </button>
            <button ref={next} type="button" className="btn sm" aria-label="Next photo" onClick={() => step(1)}>
              Next ›
            </button>
            <span className="rowcount" aria-live="polite">
              {fmtN(index + 1)} of {fmtN(order.length)}
            </span>
            <span className="flex-1" />
            <button type="button" className="btn sm" onClick={onClose}>
              Close
            </button>
          </div>
          <div>
            <h2 id="detail-title">{species.length ? species.map((s) => s.name).join(', ') : 'Untagged'}</h2>
            <div className="sci">{species.length ? species.map((s) => s.scientificName).filter(Boolean).join(', ') : 'Not tagged yet'}</div>
          </div>
          <dl className="fields">
            {fields.map(([k, v]) => (
              <div key={k} className="contents" data-field={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {full ? (
            <a className="btn sm fullsize" href={full} target="_blank" rel="noopener">
              Open full size
            </a>
          ) : (
            <span className="btn sm fullsize" aria-disabled="true">
              Open full size
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
