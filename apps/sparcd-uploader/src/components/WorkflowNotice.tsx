import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

/** Acknowledgement only: closing a warning never grants permission to upload. */
export function WorkflowNotice({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const id = useId();
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); if (previous?.isConnected) previous.focus(); };
  }, [onClose]);
  return createPortal(<div className="fixed inset-0 z-[200] bg-ink/40 grid place-items-center p-4">
    <section role="alertdialog" aria-modal="true" aria-labelledby={id} aria-describedby={`${id}-body`} className="w-full max-w-lg max-h-[90svh] overflow-auto border border-rule bg-paper p-5 space-y-4">
      <h2 id={id} className="font-display text-lg">{title}</h2>
      <div id={`${id}-body`} className="text-sm space-y-2">{children}</div>
      <button type="button" ref={close} onClick={onClose} className="min-h-11 border border-ink px-4">OK</button>
    </section>
  </div>, document.body);
}
