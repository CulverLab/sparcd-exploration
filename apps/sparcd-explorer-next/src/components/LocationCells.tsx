import { useId } from 'react';
import type { Flag } from '@/lib/tables';
import { Popover, usePopover } from './Popover';

/** A location's warnings as small buttons: each says what it means on hover, and opens its data check. */
export function FlagTags({ flags, onOpen }: { flags: Flag[]; onOpen: (flag: Flag, from: HTMLElement) => void }) {
  const id = useId();
  return (
    <>
      {flags.map((f, i) => (
        <span key={f.check}>
          <button type="button" className="tag" title={f.tip} aria-describedby={`${id}-${i}`} onClick={(e) => onOpen(f, e.currentTarget)}>
            {f.label}
          </button>
          <span id={`${id}-${i}`} hidden>
            {f.tip}
          </span>
        </span>
      ))}
    </>
  );
}

/** "2 collections", naming them on hover, and in a small list on a tap. */
export function CollectionsCell({ names }: { names: string[] }) {
  const pop = usePopover();
  const id = useId();
  const all = names.join(', ');
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        className="cellbtn"
        title={all}
        aria-describedby={id}
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        onClick={pop.toggle}
      >
        {names.length} collections
      </button>
      <span id={id} hidden>
        {all}
      </span>
      {pop.open && (
        <Popover anchor={pop.anchor} label="Collections here" onClose={pop.close}>
          <ul className="namelist">
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}
