import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** A trigger button's open state and anchor. */
export function usePopover<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const anchor = useRef<T>(null);
  return {
    open,
    anchor,
    toggle: () => setOpen((o) => !o),
    close: (refocus = false) => {
      setOpen(false);
      if (refocus) anchor.current?.focus({ preventScroll: true });
    },
  };
}

/**
 * A panel under its anchor, kept on screen. A click outside or Esc closes it;
 * Esc hands focus back to the anchor.
 */
export function Popover({
  anchor,
  label,
  onClose,
  children,
}: {
  anchor: RefObject<HTMLElement>;
  label: string;
  onClose: (refocus: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current!;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      let top = a.bottom + 4;
      if (top + h > innerHeight - 8 && a.top - h - 4 > 8) top = a.top - h - 4;
      setPos({
        left: Math.max(8, Math.min(a.left, innerWidth - 8 - w)),
        top: Math.max(8, Math.min(top, innerHeight - h - 8)),
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(el);
    addEventListener('scroll', place, { passive: true });
    addEventListener('resize', place);
    return () => {
      resize.disconnect();
      removeEventListener('scroll', place);
      removeEventListener('resize', place);
    };
  }, [anchor]);

  useEffect(() => {
    const el = ref.current;
    (
      el?.querySelector<HTMLElement>('input[type="search"]') ??
      el?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), a, select')
    )?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) closeRef.current(false);
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
  }, [anchor]);

  return createPortal(
    <div ref={ref} className="pop" role="dialog" aria-label={label} style={pos}>
      {children}
    </div>,
    document.body,
  );
}

/** A segmented control: one pressed button among a few. */
export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
  className = 'seg sm',
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={className} role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}
