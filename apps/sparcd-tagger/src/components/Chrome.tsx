import { useState, type ReactNode } from 'react';
import { BrandSwitcher, ConnectionChip } from '@sparcd/auth-ui';
import { useStore, type Section } from '../store';
import { useDraftStore, dirtyCount } from '../lib/drafts';
import { finishLocalBatch, useLocalBatch } from '../lib/localBatch';
import { StatePill } from './StatePill';

// Reuses the uploader's section-tab chrome treatment so the tools read as
// family; the tabs drive this tool's own internal navigation (no cross-app nav).
const SECTIONS: { id: Section; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'tag', label: 'Tag' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export function Chrome({ children }: { children: ReactNode }) {
  const localRecord = useLocalBatch((s) => (s.status === 'ready' ? s.record : null));
  if (localRecord) return <LocalChrome fileCount={localRecord.files.length}>{children}</LocalChrome>;
  return <CollectionChrome>{children}</CollectionChrome>;
}

/**
 * The chrome for a batch that hasn't been uploaded yet. Browse, History, Sync
 * and Snapshots are all collection concepts — there is no collection here — so
 * they are absent rather than present and inert. What's left is the one thing
 * this session is for: tag, then go back.
 */
function LocalChrome({ fileCount, children }: { fileCount: number; children: ReactNode }) {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const taggerUser = useStore((s) => s.taggerUser);
  const record = useLocalBatch((s) => s.record)!;
  const flushSaves = useDraftStore((s) => s.flushSaves);
  const [leaving, setLeaving] = useState(false);

  const done = async () => {
    setLeaving(true);
    await flushSaves();
    await finishLocalBatch(record, useDraftStore.getState().drafts, taggerUser);
  };

  return (
    <div className="h-[100dvh] flex flex-col bg-paper">
      <header className="min-h-14 shrink-0 bg-panel border-b border-rule flex flex-wrap items-center gap-3 px-4">
        <BrandSwitcher toolName="Tagger" />
        <span className="inline-flex items-center gap-1.5 border border-rule px-2 py-1 text-[12px] font-mono text-inkSoft">
          <span aria-hidden>▤</span>
          Local batch · {fileCount} files · from Uploader
        </span>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => void done()}
            disabled={leaving}
            className="min-h-11 md:min-h-0 bg-ink text-paper border border-ink px-3.5 py-2.5 md:py-1.5 text-[14px] font-body font-[600] hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            title="Save the tags and go back to the Uploader"
          >
            {leaving ? 'Saving…' : 'Done · back to Uploader'}
          </button>
          <button
            onClick={toggleTheme}
            className="w-11 h-11 md:w-8 md:h-8 grid place-items-center border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
    </div>
  );
}

function CollectionChrome({ children }: { children: ReactNode }) {
  const section = useStore((s) => s.section);
  const setSection = useStore((s) => s.setSection);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const syncState = useStore((s) => s.syncState);
  const hasUpload = useStore((s) => !!s.selectedUploadPrefix);
  const taggerUser = useStore((s) => s.taggerUser);
  const disconnect = useStore((s) => s.disconnect);
  // Local-only in P1: surface unsaved edits so the pill is honest before the P4
  // write path exists. `syncState` stays the source of truth once sync ships.
  const hasDirty = useDraftStore((s) => dirtyCount(s.drafts) > 0);
  const displayState = syncState === 'local-only' && hasDirty ? 'unsynced' : syncState;

  return (
    <div className="h-[100dvh] flex flex-col bg-paper">
      <header className="min-h-14 shrink-0 bg-panel border-b border-rule flex flex-wrap items-stretch px-4">
        <div className="flex items-center pr-6">
          <BrandSwitcher toolName="Tagger" />
        </div>

        <nav className="hidden md:flex items-stretch" aria-label="Sections">
          {SECTIONS.map((s) => {
            const active = s.id === section;
            // Tag is only reachable once an upload is chosen in Browse.
            const disabled = s.id === 'tag' && !hasUpload;
            return (
              <button
                key={s.id}
                onClick={() => !disabled && setSection(s.id)}
                disabled={disabled}
                aria-current={active ? 'page' : undefined}
                className={`relative px-4 text-[14px] font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                  active ? 'text-ink font-[600]' : 'text-inkSoft hover:text-ink'
                }`}
              >
                {s.label}
                {active && <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-ink" />}
              </button>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* Sync pill is textual; drop it below sm so the right cluster stays icon-only on phones. */}
          <span className="hidden sm:flex items-center">
            <StatePill state={displayState} />
          </span>
          <ConnectionChip identity={taggerUser || undefined} onDisconnect={disconnect} />
          <button
            onClick={toggleTheme}
            className="w-11 h-11 md:w-8 md:h-8 grid place-items-center border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
          </button>
        </div>
      </header>

      {/* Compact section tabs for <md, where the inline header nav is hidden. Same nav state/handler. */}
      <nav
        className="md:hidden shrink-0 bg-panel border-b border-rule flex items-stretch px-2 overflow-x-auto"
        aria-label="Sections"
      >
        {SECTIONS.map((s) => {
          const active = s.id === section;
          const disabled = s.id === 'tag' && !hasUpload;
          return (
            <button
              key={s.id}
              onClick={() => !disabled && setSection(s.id)}
              disabled={disabled}
              aria-current={active ? 'page' : undefined}
              className={`relative flex-1 min-h-11 px-3 text-[14px] font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${
                active ? 'text-ink font-[600]' : 'text-inkSoft hover:text-ink'
              }`}
            >
              {s.label}
              {active && <span className="absolute left-3 right-3 -bottom-px h-0.5 bg-ink" />}
            </button>
          );
        })}
      </nav>

      <main className="flex-1 min-h-0 overflow-y-auto">{children}</main>
    </div>
  );
}
