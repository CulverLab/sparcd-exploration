import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import {
  scanDataTransfer,
  scanDirectoryHandle,
  scanFileList,
  pickDirectory,
  supportsDirectoryHandle,
  type ScannedFile,
} from '../lib/scanFiles';

// iOS Safari supports neither showDirectoryPicker nor a working
// <input webkitdirectory>, so whole-folder selection is impossible there.
// A coarse-only pointer without File System Access is our proxy for a touch
// device that can't pick a folder; it falls back to a plain file picker.
function detectFolderPick() {
  return supportsDirectoryHandle || !window.matchMedia?.('(pointer: coarse)').matches;
}

export function DropZone() {
  const setFiles = useStore((s) => s.setFiles);
  const setScanning = useStore((s) => s.setScanning);
  const scanning = useStore((s) => s.scanning);
  const [hover, setHover] = useState(false);
  const [noneFound, setNoneFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // supportsDirectoryHandle is a static browser capability; only the
  // coarse-pointer proxy can flip mid-session (e.g. docking to/from tablet
  // mode), so track that media query instead of snapshotting it once.
  const [supportsFolderPick, setSupportsFolderPick] = useState(detectFolderPick);
  useEffect(() => {
    if (supportsDirectoryHandle) return;
    const mq = window.matchMedia('(pointer: coarse)');
    const update = () => setSupportsFolderPick(detectFolderPick());
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  async function commit(
    scan: () => Promise<ScannedFile[]> | ScannedFile[],
    dirHandle: FileSystemDirectoryHandle | null = null,
  ) {
    setScanning(true);
    setNoneFound(false);
    try {
      const scanned = await scan();
      setFiles(scanned, dirHandle);
      // An empty scan leaves us on the drop step; flag it so the user can tell
      // the folder was read and simply held no JPEGs (e.g. all PNGs).
      setNoneFound(scanned.length === 0);
    } finally {
      setScanning(false);
    }
  }

  // Prefer the File System Access picker so we can stash a durable handle for
  // resume; otherwise fall back to the rendered <input> — webkitdirectory on
  // desktop, or a plain multi-file picker on touch where folders aren't pickable.
  async function chooseFolder() {
    if (supportsDirectoryHandle) {
      const handle = await pickDirectory();
      if (handle) void commit(() => scanDirectoryHandle(handle), handle);
      return;
    }
    inputRef.current?.click();
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (list && list.length) void commit(() => scanFileList(list));
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setHover(false);
    const items = e.dataTransfer.items;
    // Drag-drop yields no durable handle, so resume falls back to reselect.
    if (items && items.length) void commit(() => scanDataTransfer(items));
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div
        role="button"
        tabIndex={0}
        aria-label="Drop a folder of JPEGs or MP4 videos, or choose a folder"
        onClick={() => void chooseFolder()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void chooseFolder();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
        className={`border ${
          hover
            ? 'border-accent bg-accentSoft'
            : noneFound
              ? 'border-warn bg-panel'
              : 'border-rule bg-panel'
        } px-8 py-16 text-center cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2`}
      >
        {scanning ? (
          <p className="font-body text-[15px] text-inkSoft">Scanning folder…</p>
        ) : noneFound ? (
          <>
            <p className="font-display text-[20px] text-warn mb-1">No images or videos in that folder</p>
            <p className="font-body text-[14px] text-inkSoft mb-5">
              The folder was read but held no <span className="font-mono">.jpg</span>/
              <span className="font-mono">.jpeg</span>/<span className="font-mono">.mp4</span> files.
              This tool uploads JPEG and MP4 — convert other formats first, then choose the folder
              again.
            </p>
            <span className="inline-block bg-ink text-paper border border-ink px-4 py-2 text-[14px] font-body font-[600]">
              Choose another folder
            </span>
          </>
        ) : (
          <>
            <p className="font-display text-[20px] text-ink mb-1">Drop a folder of media</p>
            <p className="font-body text-[14px] text-inkSoft mb-5">
              JPEG and MP4 files. All files in this folder, and its sub-folders, are scanned.
            </p>
            <span className="inline-block min-h-11 md:min-h-0 bg-ink text-paper border border-ink px-4 py-2 text-[14px] font-body font-[600]">
              {supportsFolderPick ? 'Choose folder' : 'Choose photos or videos'}
            </span>
            {!supportsFolderPick && (
              <p className="font-body text-[12px] text-inkSoft mt-3">
                Whole-folder selection is desktop-only. On this device, pick
                individual JPEG or MP4 files.
              </p>
            )}
          </>
        )}
      </div>

      {supportsFolderPick ? (
        <input
          ref={inputRef}
          type="file"
          // @ts-expect-error — non-standard but widely supported folder picker
          webkitdirectory=""
          directory=""
          multiple
          hidden
          onChange={onPick}
        />
      ) : (
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,video/mp4"
          multiple
          hidden
          onChange={onPick}
        />
      )}
    </div>
  );
}
