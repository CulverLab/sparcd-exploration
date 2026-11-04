import { useStore } from '@/store';
import { Choices } from '../Popover';

/** What to do with the photos whose files aren't on the server. */
export function FilesPicker() {
  const missing = useStore((s) => s.filters.missing);
  const setFilters = useStore((s) => s.setFilters);
  return (
    <>
      <div className="sect">
        <h2 className="pk-title">Photo files</h2>
      </div>
      <div className="sect">
        <Choices
          label="Photos whose files are missing"
          value={missing}
          options={[
            ['hide', 'Hide missing files'],
            ['show', 'Show missing files'],
            ['only', 'Only missing files'],
          ]}
          onChange={(to) => setFilters((f) => ({ ...f, missing: to }))}
        />
      </div>
    </>
  );
}
