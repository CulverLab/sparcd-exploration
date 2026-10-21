import { afterEach, beforeEach, expect, test, vi } from 'vitest';
let state: Record<string, unknown>;
const back = vi.fn();
beforeEach(() => {
  vi.resetModules(); state = { unrelated: 'preserved' }; back.mockClear();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('history', { get state() { return state; }, back,
    pushState(value: Record<string, unknown>) { state = value; } });
  vi.stubGlobal('location', { href: 'https://example.test/uploader/' });
});
afterEach(() => vi.unstubAllGlobals());
test('registers one entry and preserves unrelated history state', async () => {
  const { registerPreviewHistory } = await import('../src/lib/inspectPreviewHistory');
  registerPreviewHistory('preview'); registerPreviewHistory('preview');
  expect(state).toEqual({ unrelated: 'preserved', inspectPreview: 'preview' });
  window.dispatchEvent(new Event('popstate')); expect(back).not.toHaveBeenCalled();
});
test('retires current preview and bypasses later Forward traversal', async () => {
  const { registerPreviewHistory } = await import('../src/lib/inspectPreviewHistory');
  const retire = registerPreviewHistory('preview'); retire();
  expect(back).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event('popstate')); expect(back).toHaveBeenCalledTimes(2);
});
test('Back dismissal does not consume another navigation step', async () => {
  const { registerPreviewHistory } = await import('../src/lib/inspectPreviewHistory');
  const retire = registerPreviewHistory('preview'); state = { unrelated: 'preserved' };
  retire(); expect(back).not.toHaveBeenCalled();
  window.dispatchEvent(new Event('popstate')); expect(back).not.toHaveBeenCalled();
});
