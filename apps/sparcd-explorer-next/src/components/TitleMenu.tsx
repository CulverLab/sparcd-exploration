import { useEffect, useState } from 'react';
import { toggleCollection } from '@/data';
import { plural } from '@/lib/format';
import { checkForUploads, stopChecking } from '@/lib/opening';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { DataChecksPanel, useDataChecks } from './DataChecks';
import { Popover, usePopover } from './Popover';
import { SelClear } from './SelClear';
import { useCollectionCounts } from './pickers/CollectionsPicker';

function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'Updated just now';
  if (min < 60) return `Updated ${min} min ago`;
  if (min < 24 * 60) return `Updated ${Math.floor(min / 60)} h ago`;
  return `Updated ${new Date(at).toISOString().slice(0, 10)}`;
}

/** "Updated ..." and Check for new uploads. */
function Status() {
  const checking = useStore((s) => s.checking);
  const checkingFiles = useStore((s) => s.checkingFiles);
  const checkedAt = useStore((s) => s.checkedAt);
  const error = useStore((s) => s.checkError);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [checkedAt]);
  return (
    <div className="tp-status">
      <span className={error ? 'updated warn' : 'updated'} aria-live="polite">
        {checking
          ? 'Checking for new uploads…'
          : error
            ? `Couldn't check for new uploads. ${error}`
            : checkedAt !== null && ago(checkedAt, now)}
        {!checking && checkingFiles && ' · Checking photo files…'}
      </span>
      <button type="button" className="linkbtn" disabled={checking} onClick={() => void checkForUploads(true)}>
        Check for new uploads
      </button>
    </div>
  );
}

/** Each open collection's name filters to it, with its counts. */
function ByCollection() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const clear = useStore((s) => s.clearFilter);
  const counts = useCollectionCounts();
  const { hidden } = filters.collections;
  const isOn = (key: string) => hidden.length > 0 && !hidden.includes(key);
  return (
    <>
      <div className="tp-head">
        <h3>By collection</h3>
        <SelClear
          style={{ visibility: hidden.length ? 'visible' : 'hidden' }}
          tabIndex={hidden.length ? 0 : -1}
          label="Clear collection selection"
          onClick={() => {
            document.querySelector<HTMLElement>('.bclist button')?.focus({ preventScroll: true });
            clear('collections');
          }}
        />
      </div>
      <ul className="bclist">
        {model.collections.map((c, i) => (
          <li key={c.key} className={isOn(c.key) ? 'on' : undefined}>
            <button type="button" className="linkbtn" aria-pressed={isOn(c.key)} onClick={() => setFilters((f) => toggleCollection(model, f, c.key))}>
              {c.name}
            </button>
            <span className="bc-n">
              {plural(counts[i].photos, 'photo')} · {plural(counts[i].locations.size, 'location')}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * The collection title, as a button whose menu holds what belongs to the
 * opened data: each collection as a filter link, Change collections, the data
 * checks, and when it was last updated. The data checks open from here too,
 * in their own panel under the title.
 */
export function TitleMenu({ changeLabel }: { changeLabel: string }) {
  const names = useStore((s) => s.model!.collections.map((c) => c.name).join('\n')).split('\n');
  const showChooser = useStore((s) => s.showChooser);
  const menu = usePopover();
  const [checksOpen, setChecksOpen] = useState(false);
  const checks = useDataChecks();
  const many = names.length > 2;
  const n = checks.length;
  const closeChecks = (refocus: boolean) => {
    setChecksOpen(false);
    if (refocus) menu.anchor.current?.focus({ preventScroll: true });
  };
  return (
    <h1 className="collname">
      <button
        ref={menu.anchor}
        type="button"
        id="collname"
        aria-label={names.join(', ')}
        aria-haspopup="dialog"
        aria-expanded={menu.open || checksOpen}
        onClick={() => (checksOpen ? closeChecks(true) : menu.toggle())}
      >
        <span className="cn-text">
          {many ? (
            <>
              <span className="cn-first">{names[0]}</span>{' '}
              <span className="cn-more">+ {names.length - 1} more</span>
            </>
          ) : (
            <span className="cn-first">{names.join(' + ')}</span>
          )}
        </span>
        <span className="caret" aria-hidden="true" />
      </button>
      {menu.open && (
        <Popover anchor={menu.anchor} label="Collections" className="titlepop" onClose={menu.close}>
          {names.length > 1 && <ByCollection />}
          <div className="menu">
            <button type="button" onClick={() => (menu.close(), stopChecking(), showChooser())}>
              {changeLabel}
            </button>
            <button
              type="button"
              aria-haspopup="dialog"
              onClick={() => {
                menu.close();
                setChecksOpen(true);
              }}
            >
              {n > 0 && <i className="dot" aria-hidden="true" />}
              {n ? `${n} data check${n === 1 ? '' : 's'}` : 'No data problems'}
            </button>
          </div>
          <Status />
        </Popover>
      )}
      {checksOpen && <DataChecksPanel anchor={menu.anchor} onClose={closeChecks} />}
    </h1>
  );
}
