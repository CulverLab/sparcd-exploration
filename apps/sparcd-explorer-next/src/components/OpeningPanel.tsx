import type { CollectionRef } from '@sparcd/s3-safe';
import type { Progress } from '@/lib/opening';
import { fmtN } from '@/lib/format';

const nameOf = (ref: CollectionRef) => ref.name ?? ref.bucket;

function fraction(p: Progress): number {
  switch (p.step) {
    case 'ready':
      return 1;
    case 'drawing':
      return 0.95;
    case 'reading':
      return 0.1 + (0.85 * p.done) / Math.max(1, p.total);
    case 'finding':
      return 0.05;
    default:
      return 0;
  }
}

const ORDER = ['finding', 'reading', 'drawing', 'ready'];

/** One line per step of a single collection: finding uploads, reading data, drawing the map. */
function singleSteps(p: Progress) {
  const at = p.step === 'failed' || p.step === 'waiting' ? -1 : ORDER.indexOf(p.step);
  const state = (i: number) => (p.step === 'failed' && i === 0 ? 'fail' : at > i ? 'done' : at === i ? 'on' : '');
  return [
    { label: 'Finding uploads', state: state(0), count: at > 0 ? 'Done' : '' },
    { label: 'Reading data', state: state(1), count: at === 1 ? `${fmtN(p.done)} of ${fmtN(p.total)}` : at > 1 ? 'Done' : '' },
    { label: 'Drawing the map', state: state(2), count: at > 2 ? 'Done' : at === 2 ? 'Working' : '' },
  ];
}

function collectionLine(p: Progress) {
  const name = nameOf(p.ref);
  if (p.cached) return { label: `${name}: from this device`, state: 'done', count: '✓' };
  switch (p.step) {
    case 'waiting':
      return { label: `${name}: waiting`, state: '', count: '' };
    case 'finding':
      return { label: `${name}: finding uploads`, state: 'on', count: '' };
    case 'reading':
      return { label: `${name}: reading data`, state: 'on', count: `${fmtN(p.done)}/${fmtN(p.total)}` };
    case 'drawing':
      return { label: `${name}: drawing the map`, state: 'on', count: '' };
    case 'ready':
      return { label: `${name}: ready`, state: 'done', count: '✓' };
    case 'failed':
      return { label: `${name}: couldn't open`, state: 'fail', count: '' };
  }
}

export function OpeningPanel({
  refs,
  progress,
  failed,
  onCancel,
}: {
  refs: CollectionRef[];
  progress: Progress[];
  failed: boolean;
  onCancel: () => void;
}) {
  const done = progress.reduce((n, p) => n + fraction(p), 0) / Math.max(1, progress.length);
  const lines = refs.length === 1 && !progress[0].cached ? singleSteps(progress[0]) : progress.map(collectionLine);
  const errors = progress.filter((p) => p.error);
  return (
    <section className="load" aria-live="polite" aria-label="Opening">
      <h2 className="font-display text-[21px] font-[500] leading-tight">
        {refs.length === 1 ? `Opening ${nameOf(refs[0])}` : `Opening ${refs.length} collections`}
      </h2>
      <div
        className="progress"
        role="progressbar"
        aria-label="Opening progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(done * 100)}
      >
        <i style={{ width: `${Math.round(done * 100)}%` }} />
      </div>
      <ol className="steps">
        {lines.map((l) => (
          <li key={l.label} className={`step ${l.state}`}>
            <span className="dot" />
            <span>{l.label}</span>
            <span className="ct">{l.count}</span>
          </li>
        ))}
      </ol>
      {errors.map((p) => (
        <p key={p.ref.key} role="alert" className="field-err">
          {p.error}
        </p>
      ))}
      <div>
        <button type="button" className="btn" onClick={onCancel} autoFocus>
          {failed ? 'Back to the list' : 'Cancel'}
        </button>
      </div>
    </section>
  );
}
