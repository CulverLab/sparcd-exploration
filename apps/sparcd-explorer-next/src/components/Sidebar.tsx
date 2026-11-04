import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { activeFilters, type FilterDimension, type FilterState, type ListDimension } from '@/data';
import { LIST_NOUNS, SECTION_NAMES, nothingTicked, sectionValue } from '@/lib/filterLabels';
import { plural } from '@/lib/format';
import { toggleYear } from '@/lib/months';
import { PHONE, useMedia } from '@/lib/useMedia';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { Seg } from './Popover';
import { ResetSlot } from './ResetSlot';
import { CollectionsPicker } from './pickers/CollectionsPicker';
import { DatesPicker } from './pickers/DatesPicker';
import { ElevationPicker } from './pickers/ElevationPicker';
import { LocationsPicker } from './pickers/LocationsPicker';
import { RangePicker } from './pickers/RangePicker';
import { SpeciesPicker } from './pickers/SpeciesPicker';

type PickerDim = Exclude<FilterDimension, 'area' | 'files'>;

const PICKERS: Record<PickerDim, () => JSX.Element> = {
  collections: CollectionsPicker,
  species: SpeciesPicker,
  locations: LocationsPicker,
  dates: DatesPicker,
  elevation: ElevationPicker,
  ranges: RangePicker,
};

/** The sections in their fixed order. Collections shows with several collections open, Photo files when files are missing. */
const ORDER: FilterDimension[] = ['collections', 'species', 'locations', 'dates', 'area', 'ranges', 'elevation', 'files'];

/** A hex click lights the Map area section and the Filters button for a moment, so the change is seen where it lives. */
export function flashSection(dim: FilterDimension): void {
  for (const el of [document.querySelector(`.fsec[data-dim="${dim}"]`), document.getElementById('filtersbtn')]) {
    if (!el) continue;
    el.classList.remove('flash');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
  }
}

/** Takes the map into view and outlines it for a moment: the Map area section's click. */
export function revealMap(): void {
  scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  const box = document.querySelector('.mapbox');
  if (!box) return;
  box.classList.remove('flash');
  void (box as HTMLElement).offsetWidth;
  box.classList.add('flash');
  setTimeout(() => box.classList.remove('flash'), 1500);
}

/** Years with photos, one button each, in at most two even rows. */
function Years({ filters, years }: { filters: FilterState; years: number[] }) {
  const setFilters = useStore((s) => s.setFilters);
  const cols = years.length <= 5 ? years.length : years.length <= 10 ? Math.ceil(years.length / 2) : 5;
  return (
    <div className="years" role="group" aria-label="Years" style={{ '--cols': cols } as React.CSSProperties}>
      {years.map((y) => (
        <button
          key={y}
          type="button"
          aria-pressed={filters.years.includes(y)}
          onClick={() => setFilters((f) => toggleYear(f, y))}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

/**
 * A picker beside the sidebar, level with its section; full screen on a
 * phone. Esc, its × or a click outside closes it. A list closed with nothing
 * ticked shows everything again, with Undo.
 */
function SidePicker({ dim, onClose }: { dim: PickerDim; onClose: (refocus: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const Picker = PICKERS[dim];
  const label = SECTION_NAMES[dim];

  useLayoutEffect(() => {
    const el = ref.current!;
    const place = () => {
      if (innerWidth < 760) return;
      const top0 = (document.getElementById('sticky-top')?.getBoundingClientRect().bottom ?? 56) + 8;
      const maxH = innerHeight - top0 - 12;
      el.style.maxHeight = `${maxH}px`;
      const h = Math.min(el.scrollHeight, maxH);
      const anchor = document.getElementById(`fsec-${dim}`)?.getBoundingClientRect();
      const want = anchor ? anchor.top - 14 : top0;
      el.style.top = `${Math.max(top0, Math.min(want, innerHeight - h - 12))}px`;
      el.style.left = `${(document.getElementById('side')?.getBoundingClientRect().right ?? 0) + 8}px`;
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(el);
    addEventListener('resize', place);
    addEventListener('scroll', place, { passive: true });
    return () => {
      resize.disconnect();
      removeEventListener('resize', place);
      removeEventListener('scroll', place);
    };
  }, [dim]);

  useEffect(() => {
    const el = ref.current!;
    (el.querySelector<HTMLElement>('input[type="search"]') ?? el.querySelector<HTMLElement>('.pk-body input, .pk-body button:not([disabled])'))?.focus({
      preventScroll: true,
    });
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      // A section's own click opens, switches or closes; the toast's Undo stays in reach.
      if (el.contains(t) || t.closest?.('.fsec, .toast') || innerWidth < 760) return;
      closeRef.current(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current(true);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, []);

  return createPortal(
    <div ref={ref} className="picker" role="dialog" aria-label={label} data-dim={dim}>
      <div className="pk-bar">
        <button type="button" className="btn pk-back" onClick={() => onClose(true)}>
          ‹ Filters
        </button>
        <button type="button" className="iconbtn pk-close" aria-label={`Close ${label}`} onClick={() => onClose(true)}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
      <div className="pk-body">
        <Picker />
      </div>
    </div>,
    document.body,
  );
}

/**
 * The filters, one section each in a fixed order, with the result and Reset
 * at the top. Hidden or shown with the Filters button; a sheet on phones.
 */
export function Sidebar() {
  const { model, filters, result, grouping, multi } = useView();
  const unit = useStore((s) => s.display.elevation);
  const side = useStore((s) => s.side);
  const setSide = useStore((s) => s.setSide);
  const sheet = useStore((s) => s.sheet);
  const setSheet = useStore((s) => s.setSheet);
  const setFilters = useStore((s) => s.setFilters);
  const clear = useStore((s) => s.clearFilter);
  const phone = useMedia(PHONE);
  const [open, setOpen] = useState<PickerDim | null>(null);
  const active = activeFilters(filters);
  const anyMissing = model.photos.some((p) => p.missing);
  const dims = ORDER.filter((d) => (d === 'collections' ? multi : d === 'files' ? anyMissing || filters.missing === 'only' : true));

  const closePicker = (refocus: boolean) => {
    const dim = open;
    if (!dim) return;
    if (refocus) {
      // Rendered now, so a phone's sheet is no longer inert when its section takes the focus.
      flushSync(() => setOpen(null));
      document.getElementById(`fsec-${dim}`)?.focus({ preventScroll: true });
    } else setOpen(null);
    const { model: m, filters: f } = useStore.getState();
    if (dim in LIST_NOUNS && nothingTicked(m!, f, dim as ListDimension)) {
      clear(dim, `No ${LIST_NOUNS[dim as ListDimension]} were picked, so all are shown again`);
    }
  };
  // Hiding the sidebar or closing the sheet takes its picker with it.
  const shown = phone ? sheet : side;
  useEffect(() => {
    if (!shown && open) closePicker(false);
  }, [shown]);
  // A wide window has no sheet.
  useEffect(() => {
    if (!phone && sheet) setSheet(false);
  }, [phone, sheet, setSheet]);
  useEffect(() => {
    if (!sheet) return;
    document.body.classList.add('sheet-open');
    document.getElementById('closesheet')?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.picker') && closeSheet();
    document.addEventListener('keydown', key);
    return () => {
      document.body.classList.remove('sheet-open');
      document.removeEventListener('keydown', key);
    };
  }, [sheet]);
  const closeSheet = () => {
    flushSync(() => setSheet(false));
    document.getElementById('filtersbtn')?.focus({ preventScroll: true });
  };
  // On a phone the sheet, and a picker over it, are all there is: what's behind takes no focus or clicks.
  useLayoutEffect(() => {
    if (!phone || !sheet) return;
    const behind = ['sticky-top', 'main', ...(open ? ['side'] : [])].map((id) => document.getElementById(id)!);
    for (const el of behind) el.inert = true;
    return () => {
      for (const el of behind) el.inert = false;
    };
  }, [phone, sheet, open]);

  const n = active.length;
  return (
    <aside className="side" id="side" aria-label="Filters" data-open={sheet}>
      <div className="sheetbar">
        <h2>Filters</h2>
        <div className="grow" />
        <button type="button" className="iconbtn" id="closesheet" aria-label="Close filters" onClick={closeSheet}>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
          </svg>
        </button>
      </div>
      <div className="side-head">
        <div className="side-title">
          <h2>Filters</h2>
          <button
            type="button"
            className="btn quiet hidebtn"
            aria-controls="side"
            onClick={() => {
              setSide(false);
              document.getElementById('filtersbtn')?.focus({ preventScroll: true });
            }}
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.5 3.5 5 8l4.5 4.5" />
            </svg>
            Hide
          </button>
        </div>
        <p className="result" aria-live="polite">
          {n ? `${n} ${n === 1 ? 'filter' : 'filters'} on` : 'No filters on'}
        </p>
        <ResetSlot slot="side" />
      </div>
      <div className="side-list">
        {dims.map((dim) => {
          const on = active.includes(dim);
          const label = SECTION_NAMES[dim];
          const value = sectionValue(model, filters, dim, unit, grouping.separate);
          const head =
            dim === 'files' ? (
              <div className="fsec-btn" id="fsec-files">
                <span className="fsec-label">{label}</span>
                <span className="fsec-value" title={value}>
                  {value}
                </span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="fsec-btn"
                  id={`fsec-${dim}`}
                  aria-haspopup={dim === 'area' ? undefined : 'dialog'}
                  aria-expanded={dim === 'area' ? undefined : open === dim}
                  onClick={() => {
                    if (dim === 'area') {
                      closePicker(false);
                      if (sheet) setSheet(false);
                      revealMap();
                    } else if (open === dim) closePicker(true);
                    else {
                      if (open) closePicker(false);
                      setOpen(dim);
                    }
                  }}
                >
                  <span className="fsec-label">{label}</span>
                  <span className="fsec-value" title={value}>
                    {value}
                  </span>
                </button>
                <span className="fsec-chev" aria-hidden="true" />
              </>
            );
          return (
            <div key={dim} className={on ? 'fsec on' : 'fsec'} data-dim={dim}>
              {head}
              {on && (
                <button
                  type="button"
                  className="fsec-x"
                  aria-label={`Clear ${label} filter`}
                  onClick={() => {
                    if (open === dim) setOpen(null);
                    clear(dim);
                    document.getElementById(`fsec-${dim}`)?.focus({ preventScroll: true });
                  }}
                >
                  ×
                </button>
              )}
              {dim === 'dates' && model.dateSpan && (
                <div className="fsec-inline">
                  <Years filters={filters} years={yearsOf(model.dateSpan)} />
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => (open === 'dates' ? closePicker(true) : (open && closePicker(false), setOpen('dates')))}
                  >
                    More date options…
                  </button>
                </div>
              )}
              {dim === 'files' && (
                <div className="fsec-inline">
                  <Seg
                    className="seg filesseg"
                    label="Photos whose files are missing"
                    value={filters.missing}
                    options={[
                      ['hide', 'Hide missing'],
                      ['show', 'Show'],
                      ['only', 'Only missing'],
                    ]}
                    onChange={(missing) => setFilters((f) => ({ ...f, missing }))}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="sheetfoot">
        <button type="button" className="btn primary" onClick={closeSheet}>
          Show {plural(result.photos.length, 'photo')}
        </button>
      </div>
      {open && <SidePicker dim={open} onClose={closePicker} />}
    </aside>
  );
}

function yearsOf(span: { first: string; last: string }): number[] {
  const years: number[] = [];
  for (let y = Number(span.first.slice(0, 4)); y <= Number(span.last.slice(0, 4)); y++) years.push(y);
  return years;
}
