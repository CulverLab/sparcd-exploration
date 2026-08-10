import { useState, type ReactNode } from 'react';
import { BrandSwitcher, ConnectionChip } from '@sparcd/auth-ui';
import { useStore, type Section } from '../store';
import { StatePill, type UploadState } from './StatePill';
import { ConfirmNavigateAwayDialog } from './ConfirmNavigateAwayDialog';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'new', label: 'New upload' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export function Chrome({ uploadState, children }: { uploadState: UploadState; children: ReactNode }) {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const uploadRunning = useStore((s) => s.uploadRunning);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const uploaderUser = useStore((s) => s.uploaderUser);
  const disconnect = useStore((s) => s.disconnect);

  // History/Settings unmount the New-Upload wizard, which cancels a running
  // upload — confirm first instead of losing it silently. 'new' is never
  // guarded: it's where the running upload already lives.
  const [pendingSection, setPendingSection] = useState<Section | null>(null);
  const requestSection = (target: Section) => {
    if (uploadRunning && (target === 'history' || target === 'settings')) {
      setPendingSection(target);
    } else {
      setSection(target);
    }
  };

  return (
    <div className="min-h-[100svh] flex flex-col bg-paper">
      <header className="min-h-14 shrink-0 bg-panel border-b border-rule flex flex-wrap items-center gap-y-2 py-2 px-4 md:h-14 md:flex-nowrap md:items-stretch md:py-0">
        <div className="flex items-center pr-6">
          <BrandSwitcher toolName="Uploader" />
        </div>

        <select
          aria-label="Section"
          value={section}
          onChange={(e) => requestSection(e.target.value as Section)}
          className="md:hidden min-h-11 bg-panel text-ink text-[14px] font-body border border-rule px-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {SECTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>

        <nav className="hidden md:flex items-stretch" aria-label="Sections">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            return (
              <button
                key={s.id}
                onClick={() => requestSection(s.id)}
                aria-current={active ? 'page' : undefined}
                className={`relative px-4 text-[14px] font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2 ${
                  active ? 'text-ink font-[600]' : 'text-inkSoft hover:text-ink'
                }`}
              >
                {s.label}
                {active && <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-ink" />}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          <StatePill state={uploadState} />
          <ConnectionChip identity={uploaderUser || undefined} onDisconnect={disconnect} />
          <button
            onClick={toggleTheme}
            className="w-11 h-11 sm:w-8 sm:h-8 grid place-items-center border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0">{children}</main>

      {pendingSection && (
        <ConfirmNavigateAwayDialog
          onContinue={() => {
            setSection(pendingSection);
            setPendingSection(null);
          }}
          onCancel={() => setPendingSection(null)}
        />
      )}
    </div>
  );
}
