import type { Config } from 'tailwindcss';

// Field Notebook v2 tokens are driven by CSS variables (see index.css) so the
// walnut dark variant is a token swap, not a redraw.
const token = (name: string) => `var(--${name})`;

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
      keyframes: {
        throb: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.05)' },
        },
      },
      animation: {
        throb: 'throb 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
