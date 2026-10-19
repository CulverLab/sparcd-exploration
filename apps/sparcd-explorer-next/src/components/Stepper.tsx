const STEPS = ['Sign in', 'Choose collections', 'Explore'];

/** The numbered steps on the way into the workspace. */
export function Stepper({ step }: { step: 1 | 2 }) {
  return (
    <ol className="stepper" aria-label="Steps">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        return (
          <li key={label} className={done ? 'done' : n === step ? 'cur' : undefined} aria-current={n === step ? 'step' : undefined}>
            <span className="n" aria-hidden="true">
              {done ? '✓' : n}
            </span>
            {done && <span className="sr">Done: </span>}
            {label}
          </li>
        );
      })}
    </ol>
  );
}
