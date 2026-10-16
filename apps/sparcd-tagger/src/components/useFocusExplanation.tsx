import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

/** Supplements native hover titles with keyboard-visible help. The caller's
 * existing focus target owns the description, so rows need no nested controls. */
export function useFocusExplanation(description: string) {
  const id = useId();
  const anchor = useRef<HTMLElement | null>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 8 });

  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      if (!anchor.current || !text.current) return;
      const target = anchor.current.getBoundingClientRect();
      const help = text.current.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(margin, Math.min(target.left, window.innerWidth - help.width - margin));
      const top = target.bottom + 4 + help.height <= window.innerHeight - margin
        ? target.bottom + 4
        : Math.max(margin, target.top - help.height - 4);
      setPosition({ left, top });
    };
    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [open, description]);

  return {
    id,
    triggerProps: {
      onFocus: (event: FocusEvent<HTMLElement>) => { anchor.current = event.currentTarget; setOpen(true); },
      onBlur: () => setOpen(false),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (open && event.key === 'Escape') {
          event.stopPropagation();
          setOpen(false);
        }
      },
    },
    explanation: createPortal(
      <span
        ref={text}
        id={id}
        role="tooltip"
        hidden={!open}
        className="pointer-events-none fixed z-50 w-[min(22rem,calc(100vw-1rem))] break-words border border-rule bg-ink px-3 py-2 font-body text-[12px] leading-snug text-paper shadow-lg"
        style={position}
      >
        {description}
      </span>,
      document.body,
    ),
  };
}
