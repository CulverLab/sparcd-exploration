import { useMemo } from 'react';
import { NO_FILTERS, applyFilters, listKeys, only, soleSpecies, summarize, toggleSpecies } from '@/data';
import { fmtN } from '@/lib/format';
import { ACTIVE_DAYS_HELP } from '@/lib/tables';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { DataChecksPanel, useDataChecks } from './DataChecks';
import { usePopover } from './Popover';
import { useCollectionCounts } from './pickers/CollectionsPicker';

function Stat({ k, children, wide, title }: { k: React.ReactNode; children: React.ReactNode; wide?: boolean; title?: string }) {
  return (
    <div className={wide ? 'stat wide' : 'stat'} title={title}>
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

function ByCollection() {
  const { model, filters } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const counts = useCollectionCounts();
  const { hidden } = filters.collections;
  const ticked = model.collections.filter((c) => !hidden.includes(c.key));
  const sole = hidden.length && ticked.length === 1 ? ticked[0].key : null;
  const pick = (key: string) =>
    setFilters((f) => ({ ...f, collections: sole === key ? NO_FILTERS.collections : only(listKeys(model, 'collections'), [key]) }));
  return (
    <div>
      <h3 className="label mb-1">By collection</h3>
      <table className="bc">
        <thead>
          <tr>
            <th>Collection</th>
            <th className="n">Photos</th>
            <th className="n">Locations</th>
          </tr>
        </thead>
        <tbody>
          {model.collections.map((c, i) => {
            const on = hidden.length > 0 && !hidden.includes(c.key);
            return (
              <tr key={c.key} className={on ? 'on' : undefined}>
                <td>
                  <button type="button" className="linkbtn text-left text-[12px]" aria-pressed={on} onClick={() => pick(c.key)}>
                    {c.name}
                  </button>
                </td>
                <td className="n">{fmtN(counts[i].photos)}</td>
                <td className="n">{fmtN(counts[i].locations.size)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InView() {
  const { model, filters, result, grouping, multi } = useView();
  const setFilters = useStore((s) => s.setFilters);
  const checks = useDataChecks();
  const pop = usePopover();
  const sum = useMemo(() => summarize(model, result, grouping), [model, result, grouping]);
  const totalLocations = useMemo(
    () => summarize(model, applyFilters(model, NO_FILTERS), grouping).locations,
    [model, grouping],
  );
  const top = sum.topSpecies.slice(0, 5);
  const max = top[0]?.detections ?? 1;
  const sole = soleSpecies(model, filters.species);
  return (
    <section className="summary" aria-label="In view">
      <div className="sumhead">
        <h2 className="label">In view</h2>
        <div className="flex-1" />
        <button
          ref={pop.anchor}
          type="button"
          className="btn sm dqbtn"
          aria-haspopup="dialog"
          aria-expanded={pop.open}
          onClick={pop.toggle}
        >
          Data checks {checks.length > 0 && <span className="count">{checks.length}</span>}
        </button>
        {pop.open && <DataChecksPanel anchor={pop.anchor} onClose={pop.close} />}
      </div>
      <div className="stats">
        <Stat k="Locations">
          {fmtN(sum.locations)} <small>of {fmtN(totalLocations)}</small>
        </Stat>
        <Stat k="Photos">
          {fmtN(sum.photos)} <small>{sum.photos ? Math.round((sum.tagged / sum.photos) * 100) : 0}% tagged</small>
        </Stat>
        <Stat k="Detections">{fmtN(sum.detections)}</Stat>
        <Stat k="Species">{fmtN(sum.species)}</Stat>
        <Stat k="Animals counted">{fmtN(sum.animals)}</Stat>
        <Stat
          title={ACTIVE_DAYS_HELP}
          k={
            <>
              Active days <span className="qmark" aria-hidden="true">?</span>
              <span className="sr">{ACTIVE_DAYS_HELP}</span>
            </>
          }
        >
          {fmtN(sum.activeDays)}
        </Stat>
        <Stat k="Dates" wide>
          {sum.firstDate ? `${sum.firstDate} to ${sum.lastDate}` : '—'}
        </Stat>
      </div>
      {multi && <ByCollection />}
      <div>
        <h3 className="label mb-1">Top species</h3>
        {top.length ? (
          top.map((t) => {
            const s = model.species[t.species];
            const on = sole === s.key;
            return (
              <button key={s.key} type="button" className="spbar" aria-pressed={on} onClick={() => setFilters((f) => toggleSpecies(model, f, s.key))}>
                <span className="t">{s.name}</span>
                <span className="c">{fmtN(t.detections)}</span>
                <span className="b">
                  <i style={{ width: `${((t.detections / max) * 100).toFixed(1)}%` }} />
                </span>
              </button>
            );
          })
        ) : (
          <p className="fine">No detections</p>
        )}
      </div>
    </section>
  );
}
