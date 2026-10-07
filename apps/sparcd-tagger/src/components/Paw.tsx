// A wildcat track on a 108×108 grid: the metacarpal pad and four toe pads.
export function PawPads() {
  return (
    <>
      <path d="M54 86c-12 0-19-7-19-15 0-7 8-11 19-11s19 4 19 11c0 8-7 15-19 15Z" />
      <ellipse cx="33" cy="49" rx="6" ry="8" transform="rotate(-18 33 49)" />
      <ellipse cx="46" cy="38" rx="6" ry="9" transform="rotate(-6 46 38)" />
      <ellipse cx="62" cy="38" rx="6" ry="9" transform="rotate(6 62 38)" />
      <ellipse cx="75" cy="49" rx="6" ry="8" transform="rotate(18 75 49)" />
    </>
  );
}

const STEPS = [0, 1, 2, 3, 4, 5];

// Tracks crossing the frame in an alternating gait, each fading behind the
// animal, while a full-size image is on its way.
export function PawTrail() {
  return (
    <svg width="260" height="90" viewBox="0 0 260 90" aria-hidden>
      {STEPS.map((i) => (
        <g
          key={i}
          className="fn-step"
          fill="var(--ink)"
          transform={`translate(${8 + i * 42} ${i % 2 ? 44 : 14}) rotate(90 16 16) scale(0.3)`}
          style={{ animationDelay: `${i * 0.28}s` }}
        >
          <PawPads />
        </g>
      ))}
    </svg>
  );
}
