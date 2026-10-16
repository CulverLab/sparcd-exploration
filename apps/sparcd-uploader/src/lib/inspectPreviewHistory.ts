// History cannot delete an entry in the forward stack. Retired preview entries
// are therefore bypassed on traversal, rather than becoming empty app visits.
const active = new Set<string>();
let installed = false;
export function registerPreviewHistory(token: string) {
  if (!installed) {
    window.addEventListener('popstate', () => {
      const preview = history.state?.inspectPreview;
      if (preview && !active.has(preview)) history.back();
    });
    installed = true;
  }
  active.add(token);
  if (history.state?.inspectPreview !== token) {
    history.pushState({ ...history.state, inspectPreview: token }, '', location.href);
  }
  return () => {
    active.delete(token);
    if (history.state?.inspectPreview === token) history.back();
  };
}
