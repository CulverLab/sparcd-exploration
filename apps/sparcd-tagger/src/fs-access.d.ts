// File System Access permission API — the `queryPermission` / `requestPermission`
// extensions are not in the standard DOM lib, so declare the slice we use.
// `showDirectoryPicker` and `FileSystemDirectoryHandle.entries()` live in the
// DOM libs already; this only fills the permission gap.

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

// The async-iteration accessors are not in this TS DOM lib version; declare the
// `values()` walk the recursive scan uses.
interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
}

interface Window {
  showDirectoryPicker?(options?: {
    mode?: 'read' | 'readwrite';
    id?: string;
  }): Promise<FileSystemDirectoryHandle>;
}
