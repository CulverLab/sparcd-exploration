import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

// Size steps for the Browse upload table. It sits beside a 320px collection
// rail from `xl` up, so the viewport says nothing useful about how much room
// the table has: 1440px leaves it 1078px, 1280px only 918px. These are its own
// container sizes, each the sum of the tracks that step turns on, so a column
// appears exactly when it fits — Upload holding its 16rem floor and the Tagged
// progress cell its 130px one, over 16px grid gaps and the row's own 34px of
// horizontal padding and accent border. Tagged/Total and Collected are what
// this list exists to answer, so they get the earlier step; Sync waits.
//   compact: 34 + 78 + 160 + 96 + 84 tagged + 80 collected + 124 sync + 56 open + 6×6 gaps = 748px
//      → keeps all status available in the 768–939px compact band
//   sm  34 + 120 + 256 + 160 + 130 tagged + 90 collected + 5 gaps =  940px → adds Tagged/Total + Collected
//   md  …                                 + 140 sync      + 1 gap = 1096px → adds Sync
//   md's lower edge is 1072px so the flexible progress track can compress by 24px
//      in the 1440px desktop layout while leaving Sync available.
const browseTableSizes = {
  'browse-compact': '48rem',
  'browse-sm': '58.75rem',
  'browse-md': '67rem',
};

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
  plugins: [
    // Tailwind emits its own screen variants after any plugin variant, so a
    // plain `@container` variant would lose to `md:` on the same property.
    // Doubling the class self-selector settles it on specificity instead of
    // source order; the steps still resolve against each other in size order.
    plugin(({ addVariant }) => {
      for (const [name, size] of Object.entries(browseTableSizes)) {
        // This compact layout is only for the narrow band before the normal
        // Tagged/Total and Collected tracks fit. At 940px the regular table
        // layout takes over and Sync can again wait for its larger step.
        const range = name === 'browse-compact'
          ? `(min-width: ${size}) and (max-width: 58.74rem)`
          : `(min-width: ${size})`;
        addVariant(name, `@container browse-upload ${range} { && }`);
      }
    }),
  ],
} satisfies Config;
