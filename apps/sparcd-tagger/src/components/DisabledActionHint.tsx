import { cloneElement, useId, useLayoutEffect, useRef, useState, type ReactElement, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

/** Native disabled semantics, with a focusable explanation that occupies no extra rail space. */
export function DisabledActionHint({ label, reason, children }: {
  label: string;
  reason?: string;
  children: ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>;
}) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const focused = useRef(false);
  const wasDisabled = useRef(!!reason);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>();
  const cancelHide = () => { clearTimeout(hideTimer.current); };
  const contains = (node: HTMLElement | null, target: EventTarget | null) => target instanceof Node && !!node?.contains(target);
  function hideSoon() {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      if (!focused.current && !anchor.current?.matches(':hover') && !tooltip.current?.matches(':hover')) setOpen(false);
    }, 150);
  }
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number }>();
  const visible = !!reason && open;
  function show() {
    if (!reason) return;
    cancelHide();
    window.dispatchEvent(new CustomEvent('sparcd-action-hint', { detail: id }));
    setOpen(true);
  }
  // Capture before the DOM update: removing tabIndex can move Chrome focus to body.
  const restoreActionFocus = wasDisabled.current && !reason && document.activeElement === anchor.current;
  useLayoutEffect(() => {
    if (restoreActionFocus) {
      anchor.current?.querySelector('button')?.focus();
    }
    wasDisabled.current = !!reason;
  }, [reason, restoreActionFocus]);
  useLayoutEffect(() => {
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent).detail !== id) setOpen(false);
    };
    window.addEventListener('sparcd-action-hint', otherOpened);
    return () => { cancelHide(); window.removeEventListener('sparcd-action-hint', otherOpened); };
  }, [id]);
  useLayoutEffect(() => {
    if (!visible) { setPosition(undefined); return; }
    const measure = () => {
      if (!anchor.current || !tooltip.current) return;
      const rect = anchor.current.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) { setOpen(false); return; }
      const { width, height } = tooltip.current.getBoundingClientRect();
      const top = rect.bottom + height + 6 <= innerHeight - 8 ? rect.bottom + 6 : rect.top - height - 6;
      setPosition({ left: Math.max(8, Math.min(rect.left, innerWidth - width - 8)), top: Math.max(8, Math.min(top, innerHeight - height - 8)) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor.current!); observer.observe(tooltip.current!);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const outside = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node) && !tooltip.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside);
    };
  }, [visible, reason]);
  return <>
    <span ref={anchor} role={reason ? 'group' : undefined} tabIndex={reason ? 0 : undefined}
      aria-label={reason ? `${label} unavailable` : undefined} aria-describedby={reason ? id : undefined}
      className={`inline-flex ${reason ? 'cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent' : ''}`}
      onFocus={() => { focused.current = true; show(); }}
      onBlur={() => { focused.current = false; setOpen(false); }}
      onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }}
      onPointerLeave={event => { if (!contains(tooltip.current, event.relatedTarget)) hideSoon(); }}
      onClick={() => { if (reason) show(); }}
      onKeyDown={event => {
        if (!reason) return;
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); show(); }
      }}>
      {cloneElement(children, reason ? { 'aria-describedby': id, style: { ...children.props.style, pointerEvents: 'none' } } : {})}
    </span>
    {reason && createPortal(<span ref={tooltip} id={id} role="tooltip" hidden={!visible}
      className="fixed z-[110] bg-ink text-paper px-3 py-2 text-[12px] font-body shadow-lg whitespace-normal"
      style={{ ...position, visibility: visible && !position ? 'hidden' : undefined, maxWidth: 'min(320px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 16px)', overflow: 'auto' }}
      onPointerEnter={cancelHide}
      onPointerLeave={event => { if (!contains(anchor.current, event.relatedTarget)) hideSoon(); }}>
      {reason}
    </span>, document.body)}
  </>;
}
