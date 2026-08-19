// Recursive folder scan for both entry points: drag-drop (DataTransferItem +
// webkitGetAsEntry) and the "Choose folder" picker (<input webkitdirectory>).
// Produces a flat list of JPEGs and MP4 videos with their bundle-relative paths.
// EXIF, hash, thumbnail, and validation are P1 — P0 surfaces filename + size only.

export type MediaKind = 'image' | 'video';

export type ScannedFile = {
  id: string; // relPath; unique within a scan
  file: File;
  relPath: string; // path within the dropped folder, leading "/" stripped
  fileName: string;
  size: number;
  mediaKind: MediaKind;
};

function isJpeg(name: string, type: string): boolean {
  if (type === 'image/jpeg') return true;
  return /\.jpe?g$/i.test(name);
}

function isVideo(name: string, type: string): boolean {
  if (type === 'video/mp4') return true;
  return /\.mp4$/i.test(name);
}

/** Which media kind this file is, or null when it is neither accepted type. */
function mediaKindOf(name: string, type: string): MediaKind | null {
  if (isJpeg(name, type)) return 'image';
  if (isVideo(name, type)) return 'video';
  return null;
}

// A FileSystemDirectoryReader returns entries in batches; keep calling until
// it yields an empty array.
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const out: FileSystemEntry[] = [];
    const pump = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(out);
          return;
        }
        out.push(...batch);
        pump();
      }, reject);
    };
    pump();
  });
}

function entryToFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, acc: ScannedFile[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await entryToFile(fileEntry);
    const kind = mediaKindOf(file.name, file.type);
    if (!kind) return;
    const relPath = entry.fullPath.replace(/^\//, '');
    acc.push({ id: relPath, file, relPath, fileName: file.name, size: file.size, mediaKind: kind });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const children = await readAllEntries(reader);
    for (const child of children) {
      await walkEntry(child, acc);
    }
  }
}

/** Scan a drop event's items recursively. */
export async function scanDataTransfer(items: DataTransferItemList): Promise<ScannedFile[]> {
  const roots: FileSystemEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  const acc: ScannedFile[] = [];
  for (const root of roots) {
    await walkEntry(root, acc);
  }
  return acc;
}

/**
 * Whether this browser can hand back a durable folder handle. When true, the
 * "Choose folder" path stores a `FileSystemDirectoryHandle` so a closed-tab
 * resume can re-read the same bytes without asking the user to reselect.
 */
export const supportsDirectoryHandle = typeof window.showDirectoryPicker === 'function';

/**
 * Prompt for a folder via the File System Access API, returning the durable
 * handle (or null if the user dismissed the picker). Read-only — this tool
 * never writes to the local disk.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    return await window.showDirectoryPicker({ mode: 'read', id: 'sparcd-uploader' });
  } catch (err) {
    // The user closing the picker rejects with AbortError — not an error worth
    // surfacing; anything else is.
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Recursively scan a directory handle. relPaths are prefixed with the handle's
 * own name so they match the `topFolder/sub/file.jpg` shape produced by the
 * drag-drop and `webkitdirectory` paths — resume reconciliation keys on it.
 */
export async function scanDirectoryHandle(dir: FileSystemDirectoryHandle): Promise<ScannedFile[]> {
  const acc: ScannedFile[] = [];
  const walk = async (handle: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const entry of handle.values()) {
      const path = `${prefix}/${entry.name}`;
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const kind = mediaKindOf(file.name, file.type);
        if (!kind) continue;
        acc.push({ id: path, file, relPath: path, fileName: file.name, size: file.size, mediaKind: kind });
      } else {
        await walk(entry, path);
      }
    }
  };
  await walk(dir, dir.name);
  return acc;
}

/** Scan a <input webkitdirectory> FileList. */
export function scanFileList(list: ArrayLike<File>): ScannedFile[] {
  const acc: ScannedFile[] = [];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    const kind = mediaKindOf(file.name, file.type);
    if (!kind) continue;
    const relPath = (file.webkitRelativePath || file.name).replace(/^\//, '');
    acc.push({ id: relPath, file, relPath, fileName: file.name, size: file.size, mediaKind: kind });
  }
  return acc;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
