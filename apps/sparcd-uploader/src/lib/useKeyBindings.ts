import { useCallback, useEffect, useState } from 'react';
import type { Species } from './species';

const STORAGE_KEY = 'sparcd-uploader:keybindings';

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function save(b: Record<string, string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(b));
}

export function useKeyBindings(species: Species[]) {
  const [bindings, setBindings] = useState<Record<string, string>>(load);

  // Drop bindings for species no longer in the official list.
  useEffect(() => {
    if (!species.length) return;
    const names = new Set(species.map((s) => s.scientificName));
    setBindings((prev) => {
      const next: Record<string, string> = {};
      let changed = false;
      for (const [name, key] of Object.entries(prev)) {
        if (names.has(name)) next[name] = key;
        else changed = true;
      }
      if (changed) save(next);
      return changed ? next : prev;
    });
  }, [species]);

  const bindingFor = useCallback(
    (scientificName: string): string | null => bindings[scientificName] ?? null,
    [bindings],
  );

  const setBinding = useCallback((scientificName: string, key: string) => {
    setBindings((prev) => {
      const next = { ...prev, [scientificName]: key.toUpperCase() };
      save(next);
      return next;
    });
  }, []);

  const clearBinding = useCallback((scientificName: string) => {
    setBindings((prev) => {
      if (!(scientificName in prev)) return prev;
      const next = { ...prev };
      delete next[scientificName];
      save(next);
      return next;
    });
  }, []);

  return { bindingFor, setBinding, clearBinding };
}
