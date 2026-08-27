/**
 * Shared light/dark choice across every SPARC'd tool on one origin.
 *
 * Each tool applies the class itself; this is only where the choice lives, so
 * walking from one tool to another through the brand switcher lands in the
 * appearance the user already picked. localStorage rather than sessionStorage:
 * the switcher opens the other tool in the same tab, but a bookmarked tool
 * opened cold should still come up in the chosen appearance.
 */
const STORAGE_KEY = 'sparcd-theme';

export type Theme = 'light' | 'dark';

export function loadSharedTheme(): Theme | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  return raw === 'light' || raw === 'dark' ? raw : null;
}

export function saveSharedTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable (private mode / quota) — nothing to do */
  }
}
