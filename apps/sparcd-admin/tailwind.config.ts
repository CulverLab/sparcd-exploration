import type { Config } from 'tailwindcss'

const token = (name: string) =>
  `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}', '../../packages/auth-ui/src/**/*.{ts,tsx}'],
  theme: {
    borderRadius: { none: '0', DEFAULT: '0' },
    extend: {
      colors: {
        paper: token('paper'), paperHover: token('paperHover'), panel: token('panel'), panelHover: token('panelHover'),
        ink: token('ink'), inkSoft: token('inkSoft'), inkMute: token('inkMute'), rule: token('rule'), ruleSoft: token('ruleSoft'),
        accent: token('accent'), accentSoft: token('accentSoft'), warn: token('warn'), ok: token('ok'),
      },
      fontFamily: { body: ['Inter', 'system-ui', 'sans-serif'], display: ['Inter Tight', 'Inter', 'system-ui', 'sans-serif'], mono: ['ui-monospace', 'monospace'] },
    },
  },
  plugins: [],
} satisfies Config
