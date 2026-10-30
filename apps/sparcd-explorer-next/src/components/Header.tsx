import { Suspense, useEffect, useRef, useState } from 'react';
import { activeFilters, type Precision } from '@/data';
import { filtersName } from '@/lib/filterLabels';
import { initials } from '@/lib/format';
import { checkForUploads, stopChecking } from '@/lib/opening';
import { currentTheme, setTheme } from '@/lib/theme';
import { NARROW, PHONE, useMedia } from '@/lib/useMedia';
import { useStore } from '@/store';
import { DataChecksPanel, useDataChecks } from './DataChecks';
import { ReportSheet } from './later';
import { Popover, Seg, usePopover } from './Popover';
import { ResetSlot } from './ResetSlot';

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
        className="appsw"
        aria-label="Switch app"
        title="Switch app"
        aria-haspopup="menu"
        aria-expanded={pop.open}
        onClick={pop.toggle}
      >
        {Array.from({ length: 9 }, (_, i) => (
          <i key={i} />
        ))}
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
        className="btn"
        aria-haspopup="dialog"
        aria-expanded={pop.open}
        onClick={pop.toggle}
      >
        Display <span className="caret" />
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

function ago(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  if (min < 1) return 'Updated just now';
  if (min < 60) return `Updated ${min} min ago`;
  if (min < 24 * 60) return `Updated ${Math.floor(min / 60)} h ago`;
  return `Updated ${new Date(at).toISOString().slice(0, 10)}`;
}

function Status() {
  const checking = useStore((s) => s.checking);
  const checkingFiles = useStore((s) => s.checkingFiles);
  const checkedAt = useStore((s) => s.checkedAt);
  const error = useStore((s) => s.checkError);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [checkedAt]);
  return (
    <>
      <span className={error ? 'updated warn' : 'updated'} aria-live="polite">
        {checking
          ? 'Checking for new uploads…'
          : error
            ? `Couldn't check for new uploads. ${error}`
            : checkedAt !== null && ago(checkedAt, now)}
        {!checking && checkingFiles && ' · Checking photo files…'}
      </span>
      <button
        type="button"
        className={`iconbtn ${checking ? 'spin' : ''}`}
        aria-label="Check for new uploads"
        title="Check for new uploads"
        disabled={checking}
        onClick={() => void checkForUploads(true)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M13.4 8.6A5.5 5.5 0 1 1 11.9 4" />
          <path d="M12.6 1.8v2.8H9.8" />
        </svg>
      </button>
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

/** Data checks as part of the status text: quiet, always in the same place. */
function ChecksItem() {
  const checks = useDataChecks();
  const pop = usePopover();
  const n = checks.length;
  return (
    <>
      <button ref={pop.anchor} type="button" className="ckbtn" aria-haspopup="dialog" aria-expanded={pop.open} onClick={pop.toggle}>
        {n > 0 && (
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M10 2.8 18 17H2z" strokeLinejoin="round" />
            <path d="M10 8v4.2M10 14.4v.1" strokeLinecap="round" />
          </svg>
        )}
        {n ? `${n} data check${n === 1 ? '' : 's'}` : 'No data problems'}
      </button>
      {pop.open && <DataChecksPanel anchor={pop.anchor} onClose={pop.close} />}
    </>
  );
}

function ReportButton() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" className="btn primary" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Report &amp; export
      </button>
      {open && (
        <Suspense fallback={null}>
          <ReportSheet
            onClose={() => {
              setOpen(false);
              button.current?.focus({ preventScroll: true });
            }}
          />
        </Suspense>
      )}
    </>
  );
}

function ChangeButton({ label, short }: { label: string; short?: boolean }) {
  const showChooser = useStore((s) => s.showChooser);
  return (
    <button type="button" className="btn" aria-label={short ? label : undefined} onClick={() => (stopChecking(), showChooser())}>
      {short ? 'Change' : label}
    </button>
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
      className="btn filtersbtn"
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

/** One or two names joined, else the first and "+ N more"; every name in the accessible name. */
function Title() {
  const names = useStore((s) => s.model!.collections.map((c) => c.name).join('\n')).split('\n');
  const many = names.length > 2;
  return (
    <h1 className={many ? 'collname many' : 'collname'} title={names.join(', ')} aria-label={many ? names.join(', ') : undefined}>
      {many ? (
        <>
          <span className="cn-first">{names[0]}</span>{' '}
          <span className="cn-more">+ {names.length - 1} more</span>
        </>
      ) : (
        names.join(' + ')
      )}
    </h1>
  );
}

const useChangeLabel = () => (useStore((s) => s.model!.collections.length) > 1 ? 'Change collections' : 'Change collection');

/** The top bar. Under 1024 px its actions move to `NarrowActions`, a row above the figures. */
export function Header() {
  const narrow = useMedia(NARROW);
  const change = useChangeLabel();
  return (
    <header className="top" id="sticky-top">
      <FiltersButton />
      <ResetSlot slot="top" />
      <AppSwitcher />
      <Title />
      {!narrow && <ChangeButton label={change} />}
      <div className="grow" />
      {!narrow && (
        <>
          <ChecksItem />
          <Status />
          <DisplayMenu />
          <ReportButton />
        </>
      )}
      <AccountMenu changeLabel={change} />
    </header>
  );
}

export function NarrowActions() {
  const narrow = useMedia(NARROW);
  const phone = useMedia(PHONE);
  const change = useChangeLabel();
  if (!narrow) return null;
  return (
    <div className="phoneacts">
      <ChangeButton label={change} short={phone} />
      <ReportButton />
      <DisplayMenu />
      <div className="phonestatus">
        <ChecksItem />
        <Status />
      </div>
    </div>
  );
}
