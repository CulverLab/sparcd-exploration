import type { DraftObservation } from './preTags';

const KEY = 'sparcd-uploader:pretags';

function load(): Record<string, DraftObservation[]> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, DraftObservation[]>) : {};
  } catch {
    return {};
  }
}

function save(data: Record<string, DraftObservation[]>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export function getTagsForHash(sha256: string): DraftObservation[] {
  return load()[sha256] ?? [];
}

export function saveTagsForHash(sha256: string, obs: DraftObservation[]): void {
  const data = load();
  if (obs.length === 0) {
    delete data[sha256];
  } else {
    data[sha256] = obs;
  }
  save(data);
}
