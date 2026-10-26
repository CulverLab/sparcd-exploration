// Light or dark: the choice shared with the other SPARC'd tools when one was
// made, else the system's.

import { loadSharedTheme, saveSharedTheme, type Theme } from '@sparcd/auth-ui';

const system = () => matchMedia('(prefers-color-scheme: dark)');

export const currentTheme = (): Theme => loadSharedTheme() ?? (system().matches ? 'dark' : 'light');

export const applyTheme = (theme = currentTheme()) => document.documentElement.classList.toggle('dark', theme === 'dark');

export function followTheme(): void {
  applyTheme();
  system().addEventListener('change', () => applyTheme());
}

export function setTheme(theme: Theme): void {
  saveSharedTheme(theme);
  applyTheme(theme);
}
