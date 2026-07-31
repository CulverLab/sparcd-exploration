import { useEffect, useRef, useState } from 'react';
import logo from './assets/sparcd.png';

export type BrandSwitcherProps = {
  /** e.g. "Tagger" → wordmark "SPARC'd · Tagger"; also marks the current item. */
  toolName: string;
};

type Tool = { name: string; href: string };

/**
 * Sibling URLs derived from this tool's own base path so the same code works
 * in dev and on GitHub Pages. BASE_URL like '/sparcd-exploration/tagger/' →
 * family root '/sparcd-exploration/' → Home / Explorer / Uploader / Tagger.
 */
function siblingTools(): Tool[] {
  const base = import.meta.env.BASE_URL || '/';
  const root = base.replace(/[^/]+\/$/, '');
  return [
    { name: 'Home', href: root },
    { name: 'Explorer', href: `${root}explorer/` },
    { name: 'Uploader', href: `${root}uploader/` },
    { name: 'Tagger', href: `${root}tagger/` },
  ];
}

export function BrandSwitcher({ toolName }: BrandSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const tools = siblingTools();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  // When the menu opens, move focus to the current (or first) item.
  useEffect(() => {
    if (!open) return;
    const current = tools.findIndex((t) => t.name === toolName);
    const idx = current >= 0 ? current : 0;
    itemRefs.current[idx]?.focus();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function focusItem(idx: number) {
    const n = tools.length;
    const wrapped = ((idx % n) + n) % n;
    itemRefs.current[wrapped]?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent, idx: number) {
    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusItem(idx + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusItem(idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(tools.length - 1);
        break;
    }
  }

  function onButtonKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen(true);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onButtonKeyDown}
        className="flex items-center gap-2 px-1.5 py-1 text-ink hover:bg-ruleSoft/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <img src={logo} alt="" className="h-7 w-auto" />
        <span className="font-display text-[20px] font-[600] leading-none whitespace-nowrap">
          SPARC'd <span className="text-inkMute">·</span> {toolName}
        </span>
        <span aria-hidden className="text-inkMute text-[12px] leading-none">
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Switch tool"
          className="absolute left-0 top-full mt-1 min-w-[200px] bg-panel border border-rule shadow-md py-1 z-50"
        >
          {tools.map((t, i) => {
            const current = t.name === toolName;
            const className =
              'flex items-center gap-2 px-3 py-1.5 text-[14px] font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2';
            const mark = (
              <span aria-hidden className="w-3 text-accent text-[12px] leading-none">
                {current ? '✓' : ''}
              </span>
            );
            if (current) {
              return (
                <span
                  key={t.name}
                  role="menuitem"
                  aria-current="page"
                  ref={(el) => {
                    itemRefs.current[i] = el as unknown as HTMLAnchorElement | null;
                  }}
                  tabIndex={-1}
                  onKeyDown={(e) => onMenuKeyDown(e, i)}
                  className={`${className} text-ink font-[600] bg-ruleSoft/30 cursor-default outline-none`}
                >
                  {mark}
                  {t.name}
                </span>
              );
            }
            return (
              <a
                key={t.name}
                role="menuitem"
                href={t.href}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                tabIndex={-1}
                onKeyDown={(e) => onMenuKeyDown(e, i)}
                className={`${className} text-inkSoft hover:text-ink hover:bg-ruleSoft/40 no-underline`}
              >
                {mark}
                {t.name}
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
