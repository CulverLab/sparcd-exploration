import type { WizardStep } from '../store';

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'drop', label: 'Files' },
  { id: 'inspect', label: 'Inspect' },
  { id: 'assign', label: 'Assign' },
  { id: 'upload', label: 'Upload' },
];

export function StepIndicator({ current }: { current: WizardStep }) {
  const currentIndex = STEPS.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-wrap items-center gap-2 font-body" aria-label="Upload steps">
      {STEPS.map((s, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-2 px-2.5 py-1 border text-[13px] ${
                active
                  ? 'border-ink text-ink font-[600] bg-mark'
                  : done
                    ? 'border-rule text-inkSoft'
                    : 'border-ruleSoft text-inkMute'
              }`}
            >
              <span className="font-mono text-[12px]">{done ? '✓' : i + 1}</span>
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="w-3 sm:w-6 h-px bg-rule" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
