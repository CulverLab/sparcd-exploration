import { useEffect, useState } from 'react';
import type { Precision } from '@/data';
import { initials } from '@/lib/format';
import { checkForUploads, stopChecking } from '@/lib/opening';
import { currentTheme, setTheme } from '@/lib/theme';
import { useStore } from '@/store';
import { Popover, Seg, usePopover } from './Popover';

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
        className="btn wrap-sm"
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
  const checkedAt = useStore((s) => s.checkedAt);
  const error = useStore((s) => s.checkError);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => setNow(Date.now()), [checkedAt]);
  return (
    <span className="wrap-sm inline-flex min-w-0 items-center gap-0.5">
      <span className={`updated hide-sm ${error ? 'text-warn' : ''}`} aria-live="polite">
        {checking
          ? 'Checking for new uploads…'
          : error
            ? `Couldn't check for new uploads. ${error}`
            : checkedAt !== null && ago(checkedAt, now)}
      </span>
      <button
        type="button"
        className={`iconbtn ${checking ? 'spin' : ''}`}
        aria-label="Check for new uploads"
        title="Check for new uploads"
        disabled={checking}
        onClick={() => void checkForUploads()}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M13.4 8.6A5.5 5.5 0 1 1 11.9 4" />
          <path d="M12.6 1.8v2.8H9.8" />
        </svg>
      </button>
    </span>
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

export function Header() {
  const model = useStore((s) => s.model)!;
  const showChooser = useStore((s) => s.showChooser);
  const names = model.collections.map((c) => c.name);
  const multi = names.length > 1;
  const change = multi ? 'Change collections' : 'Change collection';
  return (
    <header className="top">
      <div className="top-inner">
        <AppSwitcher />
        <h1 className="collname" title={multi ? names.join(', ') : undefined}>
          {multi ? `${names[0]} + ${names.length - 1} more` : names[0]}
        </h1>
        <button type="button" className="btn sm wrap-sm" onClick={() => (stopChecking(), showChooser())}>
          <span className="hide-sm">{change}</span>
          <span className="show-sm">Change</span>
        </button>
        <div className="wrap-sm flex-1" />
        <button type="button" className="btn wrap-sm" disabled>
          Report
        </button>
        <DisplayMenu />
        <Status />
        <AccountMenu changeLabel={change} />
      </div>
    </header>
  );
}
