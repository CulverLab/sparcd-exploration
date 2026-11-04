import { useState } from 'react';
import type { ColumnPrefs } from '@/lib/columnPrefs';
import type { Col } from '@/lib/tables';
import type { PhotoLayout, Sorting } from '@/store';
import { ColumnsEditor } from './ColumnsEditor';
import { Popover, Seg, usePopover } from './Popover';

/** On Photos only: how the photos show. */
export type PhotoView = {
  layout: PhotoLayout;
  onLayout: (layout: PhotoLayout) => void;
  sorting: Sorting;
  onSorting: (sorting: Sorting) => void;
};

/**
 * A table's quiet menu beside its count: Columns…, each location ID
 * separately, and Export CSV; on Photos also Grid or List and the sort. A
 * grid has no columns to choose. Columns… opens in its own panel, under the
 * same button.
 */
export function ViewMenu({
  title,
  defs,
  prefs,
  multi,
  onPrefs,
  separate,
  onSeparate,
  photos,
  onExport,
}: {
  title: string;
  defs: Col<never>[];
  prefs: ColumnPrefs;
  multi: boolean;
  onPrefs: (p: ColumnPrefs | null) => void;
  separate: boolean;
  onSeparate: (on: boolean) => void;
  photos: PhotoView | null;
  onExport: () => void;
}) {
  const pop = usePopover();
  const [editing, setEditing] = useState(false);
  const closeEditor = (refocus: boolean) => {
    setEditing(false);
    if (refocus) pop.anchor.current?.focus({ preventScroll: true });
  };
  const order = photos?.sorting[0]?.id === 'time' ? (photos.sorting[0].desc ? 'new' : 'old') : '';
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        className="btn quiet viewbtn"
        aria-haspopup="dialog"
        aria-expanded={pop.open || editing}
        onClick={() => (editing ? closeEditor(true) : pop.toggle())}
      >
        View
        <span className="caret" aria-hidden="true" />
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} label="View" align="right" className="viewpop" onClose={pop.close}>
          {photos && (
            <>
              <div className="sect">
                <h3>Show as</h3>
                <Seg
                  className="seg"
                  label="Show as"
                  value={photos.layout}
                  options={[
                    ['grid', 'Grid'],
                    ['list', 'List'],
                  ]}
                  onChange={photos.onLayout}
                />
              </div>
              {photos.layout === 'grid' && (
                <div className="sect">
                  <h3>Order</h3>
                  <Seg<'new' | 'old' | ''>
                    className="seg"
                    label="Order"
                    value={order}
                    options={[
                      ['new', 'Newest first'],
                      ['old', 'Oldest first'],
                    ]}
                    onChange={(to) => photos.onSorting([{ id: 'time', desc: to === 'new' }])}
                  />
                </div>
              )}
            </>
          )}
          <div className="menu">
            <button
              type="button"
              aria-haspopup="dialog"
              disabled={photos?.layout === 'grid'}
              onClick={() => {
                pop.close();
                setEditing(true);
              }}
            >
              Columns…
            </button>
            {!photos && (
              <div className="swrow">
                <span id="vm-sep">Show each location ID separately</span>
                <button type="button" role="switch" className="switch" aria-checked={separate} aria-labelledby="vm-sep" onClick={() => onSeparate(!separate)} />
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                pop.close(true);
                onExport();
              }}
            >
              Export CSV
            </button>
          </div>
        </Popover>
      )}
      {editing && <ColumnsEditor anchor={pop.anchor} title={title} defs={defs} prefs={prefs} multi={multi} onChange={onPrefs} onClose={closeEditor} />}
    </>
  );
}
