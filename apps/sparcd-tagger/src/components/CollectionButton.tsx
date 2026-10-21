import { useEffect, useId, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CollectionRef } from '@sparcd/s3-safe';

type Props = {
  collection: CollectionRef;
  selected: boolean;
  onSelect: () => void;
  tooltipActive: boolean;
  onTooltipActivate: () => void;
};

/** The rail keeps its existing name/organization; the ID is supplementary help. */
export function CollectionButton({ collection, selected, onSelect, tooltipActive, onTooltipActivate }: Props) {
  const tooltipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, maxWidth: 384 });
  const [insideRow, setInsideRow] = useState(false);
  const open = tooltipActive && (hovered || focused) && !dismissed;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !tooltipRef.current) return;
    const button = buttonRef.current.getBoundingClientRect();
    const tooltipNode = tooltipRef.current;
    const margin = 8;
    // Measure with the current available width before choosing placement.
    tooltipNode.style.maxWidth = `${Math.min(384, window.innerWidth - margin * 2)}px`;
    const beside = button.right + tooltipNode.getBoundingClientRect().width <= window.innerWidth - margin;
    const maxWidth = Math.min(384, window.innerWidth - margin * 2, beside ? Infinity : button.width - margin * 2);
    tooltipNode.style.maxWidth = `${maxWidth}px`;
    const tooltip = tooltipNode.getBoundingClientRect();
    const left = beside
      ? button.right - 1
      : Math.max(margin, Math.min(button.left + margin, window.innerWidth - tooltip.width - margin));
    const top = beside
      ? Math.max(margin, Math.min(button.top, window.innerHeight - tooltip.height - margin))
      : Math.max(margin, Math.min(button.top + (button.height - tooltip.height) / 2, window.innerHeight - tooltip.height - margin));
    // In a full-width rail, keep help over its own row and let pointer events
    // reach that button. The row stays hovered while its help is read.
    setInsideRow(!beside);
    setPosition({ left, top, maxWidth });
  }, [open, collection.uuid]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => setDismissed(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [open]);

  const leave = (event: PointerEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && (buttonRef.current?.contains(next) || tooltipRef.current?.contains(next))) return;
    setHovered(false);
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={onSelect}
        onPointerEnter={() => { setHovered(true); setDismissed(false); onTooltipActivate(); }}
        onPointerLeave={leave}
        onFocus={() => { setFocused(true); setDismissed(false); onTooltipActivate(); }}
        onBlur={() => setFocused(false)}
        aria-current={selected ? 'true' : undefined}
        aria-describedby={tooltipId}
        className={`w-full text-left px-4 py-3.5 border-b border-ruleSoft border-l-2 hover:bg-panelHover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
          selected ? 'bg-mark border-l-accent' : 'border-l-transparent'
        }`}
      >
        <div className={`text-[14px] text-ink ${selected ? 'font-[600]' : ''}`}>
          {collection.name ?? collection.bucket}
        </div>
        {collection.organization && (
          <div className="text-[12px] text-inkSoft font-mono mt-1">{collection.organization}</div>
        )}
      </button>
      {createPortal(
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          hidden={!open}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={leave}
          className={`fixed z-50 w-max break-words border border-rule bg-ink px-3 py-2 font-mono text-[12px] leading-snug text-paper shadow-lg ${insideRow ? 'pointer-events-none' : ''}`}
          style={position}
        >
          Collection ID: {collection.uuid}
        </div>,
        document.body,
      )}
    </>
  );
}
