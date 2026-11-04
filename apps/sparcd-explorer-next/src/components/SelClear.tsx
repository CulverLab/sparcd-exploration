import { forwardRef, type CSSProperties } from 'react';

/** "× Clear" beside a selection: on the map, the effort strip, the title menu and the chooser. */
export const SelClear = forwardRef<
  HTMLButtonElement,
  { label: string; onClick: () => void; className?: string; style?: CSSProperties; tabIndex?: number }
>(function SelClear({ label, onClick, className, style, tabIndex }, ref) {
  return (
    <button ref={ref} type="button" className={className ? `selclear ${className}` : 'selclear'} style={style} tabIndex={tabIndex} aria-label={label} onClick={onClick}>
      <b aria-hidden="true">×</b>Clear
    </button>
  );
});
