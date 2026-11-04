import { Suspense, useState } from 'react';
import { activeFilters, type Precision } from '@/data';
import { filtersName } from '@/lib/filterLabels';
import { initials } from '@/lib/format';
import { stopChecking } from '@/lib/opening';
import { currentTheme, setTheme } from '@/lib/theme';
import { PHONE, useMedia } from '@/lib/useMedia';
import { useStore } from '@/store';
import { ReportSheet } from './later';
import { Popover, Seg, usePopover } from './Popover';
import { ResetSlot } from './ResetSlot';
import { TitleMenu } from './TitleMenu';

/** Sibling tools, from this app's own base path, as the shared BrandSwitcher does. */
function apps() {
  const root = import.meta.env.BASE_URL.replace(/[^/]+\/$/, '');
  return [
    { name: 'Home', href: root },
    { name: 'Uploader', href: `${root}uploader/` },
    { name: 'Tagger', href: `${root}tagger/` },
    { name: 'Explorer', href: import.meta.env.BASE_URL, current: true },
  ];
}

function AppSwitcher() {
  const pop = usePopover();
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        className="iconbtn appsw"
        aria-label="Switch app"
        title="Switch app"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        onClick={pop.toggle}
      >
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          {[1.5, 6.5, 11.5].flatMap((y) => [1.5, 6.5, 11.5].map((x) => <rect key={`${x} ${y}`} x={x} y={y} width="3" height="3" />))}
        </svg>
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} label="SPARC'd apps" onClose={pop.close}>
          <h3>SPARC'd apps</h3>
          <nav className="menu" aria-label="Apps">
            {apps().map((a) => (
              <a key={a.name} href={a.href} aria-current={a.current ? 'page' : undefined}>
                {a.name}
              </a>
            ))}
          </nav>
        </Popover>
      )}
    </>
  );
}

const DIGITS: [string, string][] = [
  ['exact', 'Exact'],
  ['0', '0 decimals (about 100 km)'],
  ['1', '1 decimal (about 10 km)'],
  ['2', '2 decimals (about 1 km)'],
  ['3', '3 decimals (about 100 m)'],
  ['4', '4 decimals (about 10 m)'],
  ['5', '5 decimals (about 1 m)'],
];

function DisplayMenu() {
  const pop = usePopover();
  const display = useStore((s) => s.display);
  const setDisplay = useStore((s) => s.setDisplay);
  const setPrecision = (p: Partial<Precision>) => setDisplay({ precision: { ...display.precision, ...p } });
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        className="iconbtn"
        aria-label="Display settings"
        title="Display settings"
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        onClick={pop.toggle}
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
          <path d="M8.6 2.5h2.8l.4 2.1 1.5.9 2-.7 1.4 2.4-1.6 1.4v1.8l1.6 1.4-1.4 2.4-2-.7-1.5.9-.4 2.1H8.6l-.4-2.1-1.5-.9-2 .7-1.4-2.4 1.6-1.4V9.1L3.3 7.7l1.4-2.4 2 .7 1.5-.9z" />
          <circle cx="10" cy="10" r="2.4" />
        </svg>
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} label="Display" onClose={pop.close}>
          <div className="sect">
            <h3>Coordinates</h3>
            <Seg
              label="Coordinates"
              value={display.coords}
              options={[
                ['latlon', 'Lat/Long'],
                ['utm', 'UTM'],
              ]}
              onChange={(coords) => setDisplay({ coords })}
            />
          </div>
          <div className="sect">
            <h3>Precision</h3>
            <Seg
              label="Precision method"
              value={display.precision.method}
              options={[
                ['round', 'Round'],
                ['truncate', 'Truncate'],
              ]}
              onChange={(method) => setPrecision({ method })}
            />
            <label className="sr" htmlFor="digits">
              Decimals
            </label>
            <select
              id="digits"
              className="field"
              value={display.precision.digits === null ? 'exact' : String(display.precision.digits)}
              onChange={(e) => setPrecision({ digits: e.target.value === 'exact' ? null : Number(e.target.value) })}
            >
              {DIGITS.map(([v, text]) => (
                <option key={v} value={v}>
                  {text}
                </option>
              ))}
            </select>
          </div>
          <div className="sect">
            <h3>Elevation units</h3>
            <Seg
              label="Elevation units"
              value={display.elevation}
              options={[
                ['m', 'Metres'],
                ['ft', 'Feet'],
              ]}
              onChange={(elevation) => setDisplay({ elevation })}
            />
          </div>
        </Popover>
      )}
    </>
  );
}

function AccountMenu({ changeLabel }: { changeLabel: string }) {
  const pop = usePopover();
  const config = useStore((s) => s.config)!;
  const signOut = useStore((s) => s.signOut);
  const showChooser = useStore((s) => s.showChooser);
  const [theme, setThemeState] = useState(currentTheme);
  return (
    <>
      <button
        ref={pop.anchor}
        type="button"
        className="avatar"
        aria-label="Account"
        title="Account"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        onClick={pop.toggle}
      >
        {initials(config.accessKey)}
      </button>
      {pop.open && (
        <Popover anchor={pop.anchor} label="Account" onClose={pop.close}>
          <div className="sect">
            <b>{config.accessKey}</b>
            <span className="fine mono">{config.endpoint}</span>
          </div>
          <div className="menu" role="menu">
            <button type="button" role="menuitem" onClick={() => (pop.close(), stopChecking(), showChooser())}>
              {changeLabel}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const next = theme === 'dark' ? 'light' : 'dark';
                setTheme(next);
                setThemeState(next);
              }}
            >
              {theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
            </button>
            <button type="button" role="menuitem" onClick={() => (stopChecking(), signOut())}>
              Sign out
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

/** In the top bar, or on a phone in `PhoneActions`: one at a time, so the id is the one shown. */
function ReportButton() {
  const setReport = useStore((s) => s.setReport);
  return (
    <button type="button" id="reportbtn" className="btn primary" aria-haspopup="dialog" onClick={() => setReport(true)}>
      Report &amp; export
    </button>
  );
}

function Report() {
  const open = useStore((s) => s.report);
  const setReport = useStore((s) => s.setReport);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <ReportSheet
        onClose={() => {
          setReport(false);
          document.getElementById('reportbtn')?.focus({ preventScroll: true });
        }}
      />
    </Suspense>
  );
}

/** Pressed while the sidebar shows; on a phone it opens the Filters sheet. Its count is never hidden. */
function FiltersButton() {
  const filters = useStore((s) => s.filters);
  const side = useStore((s) => s.side);
  const sheet = useStore((s) => s.sheet);
  const setSide = useStore((s) => s.setSide);
  const setSheet = useStore((s) => s.setSheet);
  const phone = useMedia(PHONE);
  const n = activeFilters(filters).length;
  return (
    <button
      type="button"
      id="filtersbtn"
      className="btn quiet filtersbtn"
      aria-controls="side"
      aria-label={filtersName(filters)}
      aria-pressed={phone ? undefined : side}
      aria-haspopup={phone ? 'dialog' : undefined}
      aria-expanded={phone ? sheet : undefined}
      onClick={() => (phone ? setSheet(!sheet) : setSide(!side))}
    >
      <svg className="sideicon" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect className="pane" x="1.5" y="2" width="5" height="12" stroke="none" />
        <rect x="1.5" y="2" width="15" height="12" rx="1.5" />
        <path d="M6.5 2v12" />
      </svg>
      <span className="lbl">Filters</span>
      <span className="n" aria-hidden="true">
        {n || ''}
      </span>
    </button>
  );
}

const useChangeLabel = () => (useStore((s) => s.model!.collections.length) > 1 ? 'Change collections' : 'Change collection');

/**
 * The top bar: on the left Filters, the Reset slot, the app switcher and the
 * collection title with its menu; on the right Report & export, the only
 * filled button, Display settings and the account. On a phone Report and
 * Display move to `PhoneActions`, a row above the figures.
 */
export function Header() {
  const phone = useMedia(PHONE);
  const change = useChangeLabel();
  return (
    <header className="top" id="sticky-top">
      <FiltersButton />
      <ResetSlot slot="top" />
      <AppSwitcher />
      <TitleMenu changeLabel={change} />
      <div className="grow" />
      {!phone && (
        <>
          <ReportButton />
          <DisplayMenu />
        </>
      )}
      <AccountMenu changeLabel={change} />
      <Report />
    </header>
  );
}

export function PhoneActions() {
  const phone = useMedia(PHONE);
  if (!phone) return null;
  return (
    <div className="phoneacts">
      <ReportButton />
      <DisplayMenu />
    </div>
  );
}
