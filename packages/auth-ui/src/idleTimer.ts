import { useEffect } from 'react';

export type IdleWatcherOptions = {
  /** Milliseconds of no activity before `onIdle` fires. */
  timeoutMs: number;
  /** Checked when the timer would otherwise fire. If true, the timer just
   *  re-arms for another `timeoutMs` instead of calling `onIdle` — a
   *  long-running unattended operation (e.g. an upload in progress) keeps
   *  postponing the check for as long as it stays busy. */
  isBusy: () => boolean;
  /** Called once the timer fires while not busy. Typically a tab-local
   *  logout — see the app's own `disconnectIdle`-style action. */
  onIdle: () => void;
};

export type IdleWatcher = {
  /** Reset the countdown — call on every activity event. */
  arm: () => void;
  /** Stop the timer for good (component unmount). */
  stop: () => void;
};

/**
 * The pure timer/busy-check logic, deliberately free of DOM event wiring so
 * it's unit-testable with fake timers. `useIdleLogout` below is the thin
 * React/DOM wrapper that feeds it activity events.
 */
export function startIdleWatcher({ timeoutMs, isBusy, onIdle }: IdleWatcherOptions): IdleWatcher {
  let timer: number;

  const check = () => {
    if (isBusy()) {
      arm(); // still busy — postpone, don't log out
      return;
    }
    onIdle();
  };

  const arm = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(check, timeoutMs);
  };

  arm();
  return { arm, stop: () => window.clearTimeout(timer) };
}

export type UseIdleLogoutOptions = {
  /** Only runs the timer while true (e.g. only while actually connected). */
  enabled: boolean;
} & IdleWatcherOptions;

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'] as const;

/**
 * Idle-triggered logout, independent per tab (no cross-tab activity signal —
 * a tab is only "idle" relative to its own input events). Deliberately not
 * tied into the shared cross-tab connection broadcast: `onIdle` is expected
 * to log out only the current tab, so an idle tab doesn't yank a sibling tab
 * out from under someone actively using it.
 */
export function useIdleLogout({ enabled, timeoutMs, isBusy, onIdle }: UseIdleLogoutOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const watcher = startIdleWatcher({ timeoutMs, isBusy, onIdle });
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, watcher.arm, { passive: true });
    return () => {
      watcher.stop();
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, watcher.arm);
    };
  }, [enabled, timeoutMs, isBusy, onIdle]);
}
