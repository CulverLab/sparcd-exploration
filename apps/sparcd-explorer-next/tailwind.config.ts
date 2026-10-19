import type { Config } from 'tailwindcss';

// Field Notebook v2 tokens are driven by CSS variables (see index.css) so the
// walnut dark variant is a token swap, not a redraw. The color-mix wrapper
// makes opacity modifiers work: with a bare var(--x), Tailwind can't inject
// alpha and silently drops every `bg-mark/70`-style class from the build.
const token = (name: string) =>
  `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    '../../packages/auth-ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    borderRadius: { none: '0', DEFAULT: '0' },
    extend: {
      colors: {
        paper: token('paper'),
        paperHover: token('paperHover'),
        panel: token('panel'),
        panelHover: token('panelHover'),
        ink: token('ink'),
        inkSoft: token('inkSoft'),
        inkMute: token('inkMute'),
        rule: token('rule'),
        ruleSoft: token('ruleSoft'),
        accent: token('accent'),
        accentSoft: token('accentSoft'),
        warn: token('warn'),
        ok: token('ok'),
        mark: token('mark'),
      },
      fontFamily: {
        display: ['Newsreader', 'Georgia', 'serif'],
        body: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
} satisfies Config;
