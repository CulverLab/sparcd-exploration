import type { RefObject } from 'react';
import { moveColumn, toggleColumn, type ColumnPrefs } from '@/lib/columnPrefs';
import type { Col } from '@/lib/tables';
import { Popover } from './Popover';

/** Show, hide and reorder a table's columns; saved per view. Opened from the View menu, under its button. */
export function ColumnsEditor({
  anchor,
  title,
  defs,
  prefs,
  multi,
  onChange,
  onClose,
}: {
  anchor: RefObject<HTMLElement>;
  title: string;
  defs: Col<never>[];
  prefs: ColumnPrefs;
  multi: boolean;
  onChange: (p: ColumnPrefs | null) => void;
  onClose: (refocus: boolean) => void;
}) {
  const byId = new Map(defs.map((d) => [d.id, d]));
  // The Collection column exists only while several collections are open.
  const listed = (id: string) => multi || !byId.get(id)?.multi;
  const ids = prefs.order.filter(listed);
  return (
    <Popover anchor={anchor} label={`Columns · ${title}`} align="right" onClose={onClose}>
      <div className="coledit grid gap-2">
        <h3>Columns · {title}</h3>
        <ol>
          {ids.map((id, i) => {
            const label = byId.get(id)!.label;
            return (
              <li key={id}>
                <label className="check">
                  <input type="checkbox" checked={prefs.visible.includes(id)} onChange={() => onChange(toggleColumn(prefs, id))} />
                  {label}
                </label>
                <span className="mv">
                  <button type="button" aria-label={`Move ${label} up`} title="Move up" disabled={i === 0} onClick={() => onChange(moveColumn(prefs, id, -1, listed))}>
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${label} down`}
                    title="Move down"
                    disabled={i === ids.length - 1}
                    onClick={() => onChange(moveColumn(prefs, id, 1, listed))}
                  >
                    ↓
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
        <div className="row">
          <button type="button" className="btn sm" onClick={() => onChange(null)}>
            Reset to default
          </button>
        </div>
      </div>
    </Popover>
  );
}
