import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Field help works with hover, focus, or a tap; its portal avoids clipping. */
export function InfoTooltip({ label, text }: { label: string; text: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const overPopup = useRef(false);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const dismiss = () => { overPopup.current = false; clearTimeout(timer.current); setOpen(false); setPinned(false); };
  function leave() {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!pinned && !overPopup.current && document.activeElement !== trigger.current) setOpen(false);
    }, 120);
  }
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open) { setPosition(undefined); return; }
    const measure = () => {
      if (!trigger.current || !popup.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const bounds = popup.current.getBoundingClientRect();
      const margin = 16, gap = 8;
      const left = Math.max(margin, Math.min(anchor.left, window.innerWidth - margin - bounds.width));
      const below = anchor.bottom + gap;
      const preferred = below + bounds.height <= window.innerHeight - margin ? below : anchor.top - gap - bounds.height;
      const top = Math.max(margin, Math.min(preferred, window.innerHeight - margin - bounds.height));
      setPosition(previous => previous?.left === left && previous.top === top ? previous : { left, top });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(trigger.current!); observer.observe(popup.current!);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !popup.current?.contains(target)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" aria-label={`About ${label}`} aria-expanded={open} aria-describedby={id}
      className="inline-flex shrink-0 items-center justify-center min-w-6 min-h-6 border border-rule rounded-full font-mono text-[12px] leading-none text-inkSoft hover:text-ink hover:border-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      onMouseEnter={() => { clearTimeout(timer.current); setOpen(true); }} onMouseLeave={leave}
      onFocus={() => setOpen(true)} onBlur={leave}
      onClick={() => { if (pinned) dismiss(); else { clearTimeout(timer.current); setPinned(true); setOpen(true); } }}>
      <span aria-hidden>ⓘ</span>
    </button>
    {open && createPortal(<span ref={popup} id={id} role="tooltip"
      className="fixed z-[100] border border-rule bg-ink px-3 py-2 font-body text-[12px] normal-case tracking-normal leading-snug text-paper shadow-lg overflow-auto"
      style={{ ...position, visibility: position ? 'visible' : 'hidden', width: 'min(18rem, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 32px)' }}
      onMouseEnter={() => { overPopup.current = true; clearTimeout(timer.current); }}
      onMouseLeave={() => { overPopup.current = false; leave(); }}>{text}</span>, document.body)}
    {/* Keep a stable accessible description when the visual popup is closed. */}
    {!open && <span id={id} className="sr-only">{text}</span>}
  </>;
}
