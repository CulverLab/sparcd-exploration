import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import type { Model, PhotoRow } from '@/data';
import { frameJob, photoKey, useMissing, useThumb } from '@/lib/thumbs';
import { useStore } from '@/store';

// Tiles at least 150px wide (130px on phones), 3:2 pictures over a fixed caption.
const GAP = 8;
const CAPTION = 60;

const panel = () => document.querySelector<HTMLElement>('#table .tbl-wrap');

/** Rows away from the screen: 0 on screen, more the further a tile sits from it. */
const distance = (index: number, range: { startIndex: number; endIndex: number } | null) =>
  !range ? 0 : index < range.startIndex ? range.startIndex - index : index > range.endIndex ? index - range.endIndex : 0;

/** A loaded video element, moved into the tile as is so its first frame never loads twice. */
function Frame({ video }: { video: HTMLVideoElement }) {
  const box = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    box.current!.append(video);
    return () => video.remove();
  }, [video]);
  return <span ref={box} className="frame" />;
}

function Tile({ model, row, priority, onOpen }: { model: Model; row: PhotoRow; priority: number; onOpen: (row: PhotoRow, from: HTMLElement) => void }) {
  const photo = model.photos[row.photo];
  const site = model.sites[photo.site];
  const key = photoKey(model, row.photo);
  const missing = useMissing(model, row.photo);
  // A video shows its first frame, loaded only while its tile is on screen.
  const job = missing ? null : photo.video ? (priority === 0 ? frameJob(key) : null) : key;
  const { thumb, failed } = useThumb(job, priority);
  const state = missing ? 'missing' : photo.video ? (thumb ? 'frame' : 'video') : thumb ? thumb.kind : failed ? 'failed' : 'loading';
  const names = row.species || 'Untagged';
  return (
    <button
      type="button"
      className={missing ? 'tile missing' : 'tile'}
      data-photo={row.photo}
      data-thumb={state}
      aria-label={`${names}, ${row.time}${photo.video ? ', video' : ''}`}
      onClick={(e) => onOpen(row, e.currentTarget)}
    >
      <span className={photo.video ? 'ph video' : 'ph'}>
        {thumb?.video ? <Frame video={thumb.video} /> : thumb && <img src={thumb.url} alt="" draggable={false} />}
        {missing ? (
          <span className="noprev">File not found</span>
        ) : (
          failed && !photo.video && <span className="noprev">No preview</span>
        )}
        {photo.video && !missing && <span className="play">Video</span>}
      </span>
      <span className="cap">
        <b className={row.species ? undefined : 'untag'}>{names}</b>
        <span>{row.time || '—'}</span>
        <span>{site.noLocation ? 'No location set' : row.locationId}</span>
      </span>
    </button>
  );
}

type Shown = { model: Model; rows: PhotoRow[] };

/** Whether `rows` are `before.rows` less only photos found gone. */
function lessOnlyGone(before: Shown, model: Model, rows: PhotoRow[], gone: ReadonlySet<string>): boolean {
  if (!gone.size || rows.length >= before.rows.length) return false;
  let j = 0;
  for (const r of before.rows) {
    const key = photoKey(before.model, r.photo);
    if (j < rows.length && photoKey(model, rows[j].photo) === key) j++;
    else if (!gone.has(key)) return false;
  }
  return j === rows.length;
}

/**
 * The grid's rows and the model they index. When a rebuild leaves out photos
 * found gone, their tiles stay, reading "File not found", until the rows
 * change for another reason, so a missing file never shifts the grid; the
 * counts leave them out at once.
 */
export function useSteadyRows(model: Model, rows: PhotoRow[]): Shown {
  const gone = useStore((s) => s.gone);
  const last = useRef<Shown>({ model, rows });
  const shown = useMemo(() => {
    const before = last.current;
    return before.model !== model && lessOnlyGone(before, model, rows, gone) ? before : { model, rows };
  }, [model, rows, gone]);
  useLayoutEffect(() => {
    last.current = shown;
  }, [shown]);
  return shown;
}

/**
 * The photos in view as thumbnails, in the List's order. Only rows on or near
 * the screen are drawn, so only their thumbnails load; a row scrolled far away
 * unmounts and cancels its loads.
 */
export function PhotoGrid({
  model,
  rows,
  onOpen,
  initialScroll,
}: {
  model: Model;
  rows: PhotoRow[];
  onOpen: (row: PhotoRow, from: HTMLElement) => void;
  /** Where the page is about to scroll to as the grid opens. */
  initialScroll: number | null;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  // Sized and placed from the panel it opens in, so the first render is already
  // full height and nothing shifts while a switch from List restores its scroll.
  const [width, setWidth] = useState(() => panel()?.clientWidth ?? 0);
  const [margin, setMargin] = useState(() => (panel()?.getBoundingClientRect().top ?? 0) + scrollY);

  useLayoutEffect(() => {
    const el = wrap.current!;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const top = wrap.current!.getBoundingClientRect().top + scrollY;
    if (Math.abs(top - margin) > 1) setMargin(top);
  });

  const pad = width < 600 ? 6 : 10;
  const minTile = width < 600 ? 130 : 150;
  const inner = Math.max(0, width - 2 * pad);
  const cols = Math.max(1, Math.floor((inner + GAP) / (minTile + GAP)));
  const tileW = (inner - (cols - 1) * GAP) / cols;
  const rowH = Math.round((tileW * 2) / 3) + CAPTION + GAP;
  const count = width ? Math.ceil(rows.length / cols) : 0;

  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize: () => rowH,
    overscan: 3,
    scrollMargin: margin + pad,
    initialOffset: initialScroll ?? (() => scrollY),
  });
  const sizedFor = useRef(rowH);
  useEffect(() => {
    if (sizedFor.current === rowH) return;
    sizedFor.current = rowH;
    virtualizer.measure();
  }, [virtualizer, rowH]);
  const items = virtualizer.getVirtualItems();
  const range = virtualizer.range;

  return (
    <div ref={wrap} className="gallery" style={{ height: count ? virtualizer.getTotalSize() + 2 * pad - GAP : undefined }}>
      {items.map((item) => (
        <div
          key={item.key}
          className="gal-row"
          style={{
            left: pad,
            right: pad,
            height: rowH - GAP,
            transform: `translateY(${item.start - margin}px)`,
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          }}
        >
          {rows.slice(item.index * cols, (item.index + 1) * cols).map((row) => (
            <Tile key={row.photo} model={model} row={row} priority={distance(item.index, range)} onOpen={onOpen} />
          ))}
        </div>
      ))}
    </div>
  );
}
