import { useEffect, useMemo, useRef, useState } from 'react';
import type { Location } from '../lib/locations';
import { metersToFeet, type ElevationUnit } from '../lib/coords';

type Props = {
  locations: Location[];
  value: string | null; // selected Location.key
  onChange: (key: string) => void;
  elevationUnit?: ElevationUnit;
};

/**
 * Searchable combobox over the camera-location registry. Filters by name or
 * id; arrow keys move the highlight, Enter selects, Esc closes. Bespoke to
 * match the Field Notebook chrome rather than pulling in a dropdown library.
 */
export function DeploymentPicker({ locations, value, onChange, elevationUnit = 'meters' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  // Detail popover open-state, keyed on `loc.key` — NOT `loc.id`, which repeats
  // across distinct coordinates (the id-is-not-unique data contract).
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => locations.find((l) => l.key === value) ?? null, [locations, value]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter(
      (l) => l.name.toLowerCase().includes(q) || l.id.toLowerCase().includes(q),
    );
  }, [locations, query]);

  // Keep the highlight in range as the filter narrows.
  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDetailKey(null);
      }
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  function choose(loc: Location) {
    onChange(loc.key);
    setQuery('');
    setOpen(false);
    setDetailKey(null);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const loc = matches[highlight];
      if (loc) choose(loc);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setDetailKey(null);
    }
  }

  // Dual-unit elevation, preferred unit emphasized. No coordinates — camera
  // locations aren't shown here to keep exact positions out of the UI.
  function LocationDetail({ loc }: { loc: Location }) {
    return (
      <dl className="mt-1 space-y-0.5 font-mono text-[11px] text-inkMute">
        <div className="flex gap-2">
          <dt className="w-10 shrink-0 text-inkSoft">Elev</dt>
          <dd className="truncate">
            <span className={elevationUnit === 'meters' ? 'text-ink' : ''}>{loc.elevation} m</span>
            {' · '}
            <span className={elevationUnit === 'feet' ? 'text-ink' : ''}>
              {metersToFeet(loc.elevation)} ft
            </span>
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 border border-rule bg-paper px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
      >
        {selected ? (
          <span className="min-w-0">
            <span className="block truncate font-body text-[14px] text-ink">{selected.name}</span>
            <span className="block truncate font-mono text-[12px] text-inkMute">{selected.id}</span>
          </span>
        ) : (
          <span className="font-body text-[14px] text-inkMute">Select a deployment location…</span>
        )}
        <span aria-hidden className="text-inkSoft text-[12px]">
          ▾
        </span>
      </button>

      {open && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex max-h-[70dvh] flex-col border border-rule bg-panel shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:z-10 sm:mt-1 sm:block sm:max-h-none sm:w-full">
          <div className="flex items-center gap-2 p-2 border-b border-ruleSoft sm:block">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setOpen(true);
              }}
              onKeyDown={onKeyDown}
              placeholder="Filter by name or id…"
              className="min-w-0 flex-1 sm:w-full sm:flex-none border border-rule bg-paper px-2.5 py-1.5 font-body text-[14px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setDetailKey(null);
              }}
              aria-label="Close"
              className="shrink-0 grid place-items-center min-w-11 min-h-11 border border-rule text-inkSoft text-[14px] sm:hidden"
            >
              ✕
            </button>
          </div>
          <ul role="listbox" className="flex-1 min-h-0 overflow-auto sm:max-h-[280px] sm:flex-none">
            {matches.length === 0 && (
              <li className="px-3 py-2 font-body text-[13px] text-inkMute">No matching locations.</li>
            )}
            {matches.map((loc, i) => (
              <li
                key={loc.key}
                role="option"
                aria-selected={loc.key === value}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(loc)}
                className={`px-3 py-2 cursor-pointer border-b border-ruleSoft last:border-b-0 ${
                  i === highlight ? 'bg-mark' : 'hover:bg-panelHover'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-body text-[14px] text-ink">{loc.name}</span>
                    <span className="block truncate font-mono text-[12px] text-inkMute">
                      {loc.id} · {loc.elevation} m
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDetailKey((k) => (k === loc.key ? null : loc.key));
                    }}
                    aria-expanded={detailKey === loc.key}
                    aria-label={`Details for ${loc.name}`}
                    className="shrink-0 min-w-11 min-h-11 sm:min-w-5 sm:min-h-5 grid place-items-center border border-rule text-inkSoft hover:text-ink hover:border-ink [@media(hover:none)]:text-ink [@media(hover:none)]:border-ink text-[11px] font-mono focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                  >
                    i
                  </button>
                </div>
                {detailKey === loc.key && <LocationDetail loc={loc} />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
