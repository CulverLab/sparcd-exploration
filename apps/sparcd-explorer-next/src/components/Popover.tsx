import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
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

const FOCUSABLE = 'a[href], button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), select:not([disabled])';

/** Tab stays inside a panel, which sits at the page's end; the arrows, Home and End move through it, except inside a field that uses them. */
function moveFocus(e: ReactKeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  let to: number;
  if (e.key === 'Tab') {
    if (e.shiftKey ? at > 0 : at < last) return;
    to = e.shiftKey ? last : 0;
  } else {
    if ((e.target as HTMLElement).closest('select, input:not([type="checkbox"])')) return;
    if (e.key === 'ArrowDown') to = at < last ? at + 1 : 0;
    else if (e.key === 'ArrowUp') to = at > 0 ? at - 1 : last;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = last;
    else return;
  }
  e.preventDefault();
  items[to]?.focus({ preventScroll: true });
}

/**
 * A panel under its anchor, kept on screen. A click outside or Esc closes it;
 * Esc hands focus back to the anchor.
 */
export function Popover({
  anchor,
  label,
  onClose,
  className,
  align = 'left',
  children,
}: {
  anchor: RefObject<HTMLElement>;
  label: string;
  onClose: (refocus: boolean) => void;
  className?: string;
  /** Which edge of the anchor the panel lines up with. */
  align?: 'left' | 'right';
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
      let top = a.bottom + 6;
      if (top + h > innerHeight - 8 && a.top - h - 6 > 8) top = a.top - h - 6;
      setPos({
        left: Math.max(8, Math.min(align === 'right' ? a.right - w : a.left, innerWidth - 8 - w)),
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
  }, [anchor, align]);

  useEffect(() => {
    const el = ref.current;
    (el?.querySelector<HTMLElement>('input[type="search"]') ?? el?.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
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
    <div ref={ref} className={className ? `pop ${className}` : 'pop'} role="dialog" aria-label={label} style={pos} onKeyDown={moveFocus}>
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

/** One choice of a few, as a list of radio buttons: the arrows move and choose, as they do in any radio group. */
export function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="choices"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        e.stopPropagation();
        const at = options.findIndex(([v]) => v === value);
        const to = (at + step + options.length) % options.length;
        onChange(options[to][0]);
        e.currentTarget.querySelectorAll('button')[to].focus({ preventScroll: true });
      }}
    >
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} tabIndex={v === value ? 0 : -1} onClick={() => onChange(v)}>
          <i aria-hidden="true" />
          {text}
        </button>
      ))}
    </div>
  );
}
