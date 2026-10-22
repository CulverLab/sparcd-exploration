import { moveColumn, toggleColumn, type ColumnPrefs } from '@/lib/columnPrefs';
import type { Col } from '@/lib/tables';
import { Popover, usePopover } from './Popover';

/** Show, hide and reorder a table's columns; saved per view. */
export function ColumnsEditor({
  title,
  defs,
  prefs,
  multi,
  disabled,
  onChange,
}: {
  title: string;
  defs: Col<never>[];
  prefs: ColumnPrefs;
  multi: boolean;
  disabled: boolean;
  onChange: (p: ColumnPrefs | null) => void;
}) {
  const pop = usePopover();
  const byId = new Map(defs.map((d) => [d.id, d]));
  // The Collection column exists only while several collections are open.
  const listed = (id: string) => multi || !byId.get(id)?.multi;
  const ids = prefs.order.filter(listed);
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        className="btn"
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        disabled={disabled}
        onClick={pop.toggle}
      >
        Columns
      </button>
      {pop.open && !disabled && (
        <Popover anchor={pop.anchor} label={`Columns · ${title}`} onClose={pop.close}>
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
                      <button
                        type="button"
                        aria-label={`Move ${label} up`}
                        title="Move up"
                        disabled={i === 0}
                        onClick={() => onChange(moveColumn(prefs, id, -1, listed))}
                      >
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
      )}
    </>
  );
}
