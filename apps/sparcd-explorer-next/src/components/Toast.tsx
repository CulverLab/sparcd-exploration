import { useEffect } from 'react';
import { useStore } from '@/store';

/** "Filters reset" with Undo for 8 s; plain notes for 2.5 s. */
export function Toast() {
  const toast = useStore((s) => s.toast);
  const hide = useStore((s) => s.hideToast);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(hide, toast.undo ? 8000 : 2500);
    return () => clearTimeout(timer);
  }, [toast, hide]);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.undo && (
        <button type="button" onClick={toast.undo}>
          Undo
        </button>
      )}
    </div>
  );
}
