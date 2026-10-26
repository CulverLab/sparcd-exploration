import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type TipAt = { x: number; y: number; content: ReactNode };

/** A hover note that follows the pointer and stays on screen. */
export function Tip({ at }: { at: TipAt | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!at || !el) return;
    let left = at.x + 14;
    let top = at.y + 14;
    if (left + el.offsetWidth > innerWidth - 8) left = Math.max(8, at.x - el.offsetWidth - 14);
    if (top + el.offsetHeight > innerHeight - 8) top = Math.max(8, at.y - el.offsetHeight - 14);
    setPos({ left, top });
  }, [at]);
  if (!at) return null;
  return createPortal(
    <div ref={ref} className="tip" role="tooltip" style={pos}>
      {at.content}
    </div>,
    document.body,
  );
}
