import { type ReactNode } from 'react'
import { BrandSwitcher, ConnectionChip, type Theme } from '@sparcd/auth-ui'

export type AdminSection = 'species' | 'locations' | 'collections' | 'settings'

const sections: { id: AdminSection; label: string }[] = [
  { id: 'species', label: 'Species' },
  { id: 'locations', label: 'Locations' },
  { id: 'collections', label: 'Collections' },
  { id: 'settings', label: 'Settings' },
]

export function Chrome({
  identity,
  theme,
  section,
  onSectionChange,
  onToggleTheme,
  onDisconnect,
  children,
}: {
  identity: string
  theme: Theme
  section: AdminSection
  onSectionChange: (section: AdminSection) => void
  onToggleTheme: () => void
  onDisconnect: () => void
  children: ReactNode
}) {
  const item = (id: AdminSection, label: string, compact: boolean) => {
    const active = id === section
    return (
      <button
        type="button"
        key={id}
        onClick={() => onSectionChange(id)}
        aria-current={active ? 'page' : undefined}
        className={`relative text-[14px] font-body focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent -outline-offset-2 ${
          compact ? 'flex-1 min-h-11 px-3' : 'w-full px-4 py-3 text-left'
        } ${active ? 'bg-accentSoft text-ink font-[600]' : 'text-inkSoft hover:bg-panelHover hover:text-ink'}`}
      >
        {label}
        {active && <span className={`absolute bg-ink ${compact ? 'left-3 right-3 -bottom-px h-0.5' : 'left-0 top-0 bottom-0 w-0.5'}`} />}
      </button>
    )
  }

  return (
    <div className="min-h-[100svh] flex flex-col bg-paper">
      <header className="min-h-14 shrink-0 bg-panel border-b border-rule flex flex-wrap items-center gap-y-2 py-2 px-4 md:h-14 md:flex-nowrap md:py-0">
        <div className="flex items-center pr-6"><BrandSwitcher toolName="Admin" /></div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3">
          <ConnectionChip identity={identity || undefined} onDisconnect={onDisconnect} />
          <button
            type="button"
            onClick={onToggleTheme}
            className="w-11 h-11 sm:w-8 sm:h-8 grid place-items-center border border-rule text-inkSoft hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
            aria-label={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
            title={theme === 'light' ? 'Switch to dark' : 'Switch to light'}
          >
            <span aria-hidden>{theme === 'light' ? '☾' : '☀'}</span>
          </button>
        </div>
      </header>
      <nav className="md:hidden shrink-0 bg-panel border-b border-rule flex items-stretch" aria-label="Sections">
        {sections.map((entry) => item(entry.id, entry.label, true))}
      </nav>
      <div className="flex-1 min-h-0 flex">
        <nav className="hidden md:block w-56 shrink-0 bg-panel border-r border-rule" aria-label="Sections">
          {sections.map((entry) => item(entry.id, entry.label, false))}
        </nav>
        <main className="flex-1 min-w-0 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
