import { expect, type Page } from '@playwright/test';

/** Verify the actual worker's complete cache; no app-state seeding or preparation click. */
export async function waitForOfflineApps(page: Page, base = '/sparcd-exploration/') {
  await expect.poll(() => page.evaluate(async root => {
    const active = (await navigator.serviceWorker.getRegistration(root))?.active;
    if (!active) return false;
    return new Promise<boolean>(resolve => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 3000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data.ready === true); };
      active.postMessage({ type: 'STATUS' }, [channel.port2]);
    });
  }, base), { timeout: 30_000 }).toBe(true);
}
