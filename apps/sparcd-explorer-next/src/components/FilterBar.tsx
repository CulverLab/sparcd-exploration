import type { FilterDimension } from '@/data';
import { filterButtons, photoCountLabel, type FilterButton } from '@/lib/filterLabels';
import { useTableView } from '@/lib/useTableView';
import { useView } from '@/lib/useView';
import { useStore } from '@/store';
import { Popover, usePopover } from './Popover';
import { CollectionsPicker } from './pickers/CollectionsPicker';
import { DatesPicker } from './pickers/DatesPicker';
import { ElevationPicker } from './pickers/ElevationPicker';
import { LocationsPicker } from './pickers/LocationsPicker';
import { RangePicker } from './pickers/RangePicker';
import { SpeciesPicker } from './pickers/SpeciesPicker';

const PICKERS: Partial<Record<FilterDimension, () => JSX.Element>> = {
  collections: CollectionsPicker,
  species: SpeciesPicker,
  locations: LocationsPicker,
  dates: DatesPicker,
  elevation: ElevationPicker,
  ranges: RangePicker,
};

function FilterButtonView({ button }: { button: FilterButton }) {
  const pop = usePopover();
  const clear = useStore((s) => s.clearFilter);
  const Picker = PICKERS[button.dim];
  return (
    <span className={button.active ? 'fb on' : 'fb'}>
      <button
        ref={pop.anchor}
        type="button"
        className="btn fbtn"
        aria-haspopup={Picker ? 'dialog' : undefined}
        aria-expanded={Picker ? pop.open : undefined}
        onClick={Picker ? pop.toggle : () => document.getElementById(button.dim === 'area' ? 'map' : 'table')?.scrollIntoView({ block: 'nearest' })}
      >
        <span className="lbl">{button.label}</span>
        {!button.active && <span className="caret" />}
      </button>
      {button.active && (
        <button
          type="button"
          className="fbx"
          aria-label={`Clear ${button.name} filter`}
          onClick={() => {
            clear(button.dim);
            pop.anchor.current?.focus({ preventScroll: true });
          }}
        >
          ×
        </button>
      )}
      {pop.open && Picker && (
        <Popover anchor={pop.anchor} label={button.name} onClose={pop.close}>
          <Picker />
        </Popover>
      )}
    </span>
  );
}

/** One line, always: each filter shows its own state, then the count and Reset. */
export function FilterBar() {
  const { model, filters, result, active, grouping } = useView();
  const unit = useStore((s) => s.display.elevation);
  const reset = useStore((s) => s.resetFilters);
  const { updating } = useTableView();
  return (
    <div className="filterbar">
      <div className="fbtns" role="group" aria-label="Filters">
        {filterButtons(model, filters, unit, grouping.separate).map((b) => (
          <FilterButtonView key={b.dim} button={b} />
        ))}
      </div>
      <div className="fright">
        {updating && (
          <span className="updating" role="status">
            Updating…
          </span>
        )}
        <span className="result" aria-live="polite">
          {photoCountLabel(result.photos.length, result.total, active)}
        </span>
        <button type="button" className="btn" disabled={!active} onClick={reset}>
          <span className="rs-long">Reset filters</span>
          <span className="rs-short">Reset</span>
        </button>
      </div>
    </div>
  );
}
