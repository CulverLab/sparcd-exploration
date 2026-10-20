import { useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionRef } from '../lib/s3';

type Props = {
  label?: string;
  collections: CollectionRef[];
  value: string | null; // selected CollectionRef.key
  onChange: (key: string) => void;
};

/** `organization · contact`, or the bucket when neither is present. */
function meta(c: CollectionRef): string {
  return [c.organization, c.contact].filter(Boolean).join(' · ') || c.bucket;
}

/**
 * Searchable combobox over the discovered collections. Filters by name,
 * organization, contact, description, or bucket/uuid; arrow keys move the
 * highlight, Enter selects, Esc closes. Bespoke to match the Field Notebook
 * chrome (mirrors DeploymentPicker) rather than pulling in a dropdown library.
 */
export function CollectionPicker({ collections, value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => collections.find((c) => c.key === value) ?? null,
    [collections, value],
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return collections;
    return collections.filter((c) =>
      [c.name, c.organization, c.contact, c.description, c.bucket, c.uuid].some((f) =>
        f?.toLowerCase().includes(q),
      ),
    );
  }, [collections, query]);

  useEffect(() => {
    setHighlight((h) => Math.min(h, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  function choose(c: CollectionRef) {
    onChange(c.key);
    setQuery('');
    setOpen(false);
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
      const c = matches[highlight];
      if (c) choose(c);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 border border-rule bg-paper px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
      >
        {selected ? (
          <span className="min-w-0">
            <span className="block truncate font-body text-[14px] text-ink">
              {selected.name ?? '(unnamed)'}
            </span>
            <span className="block truncate font-mono text-[12px] text-inkMute">{meta(selected)}</span>
          </span>
        ) : (
          <span className="font-body text-[14px] text-inkMute">Select a target collection…</span>
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
              placeholder="Filter by name, organization, contact…"
              className="min-w-0 flex-1 sm:w-full sm:flex-none border border-rule bg-paper px-2.5 py-1.5 font-body text-[14px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="shrink-0 grid place-items-center min-w-11 min-h-11 border border-rule text-inkSoft text-[14px] sm:hidden"
            >
              ✕
            </button>
          </div>
          <ul role="listbox" className="flex-1 min-h-0 overflow-auto sm:max-h-[280px] sm:flex-none">
            {matches.length === 0 && (
              <li className="px-3 py-2 font-body text-[13px] text-inkMute">
                No matching collections.
              </li>
            )}
            {matches.map((c, i) => (
              <li
                key={c.key}
                role="option"
                aria-selected={c.key === value}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => choose(c)}
                className={`px-3 py-2 cursor-pointer border-b border-ruleSoft last:border-b-0 ${
                  i === highlight ? 'bg-mark' : 'hover:bg-panelHover'
                }`}
              >
                <span className="block truncate font-body text-[14px] text-ink">
                  {c.name ?? '(unnamed)'}
                </span>
                <span className="block truncate font-mono text-[12px] text-inkMute">{meta(c)}</span>
                {c.description && (
                  <span className="block truncate font-body text-[12px] text-inkMute">
                    {c.description}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
