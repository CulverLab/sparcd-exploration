// Sibling-tool URLs derived from this tool's own base path, the same way
// BrandSwitcher's `siblingTools()` does it, so the same code works in dev and
// on GitHub Pages. BASE_URL '/sparcd-exploration/tagger/' → family root
// '/sparcd-exploration/' → the uploader at '/sparcd-exploration/uploader/'.

const familyRoot = (): string => (import.meta.env.BASE_URL || '/').replace(/[^/]+\/$/, '');

/** The path the uploader is served from. */
export const uploaderPath = (): string => `${familyRoot()}uploader/`;

/**
 * Where the Done button is allowed to go.
 *
 * A hand-off record is read out of a database every page on this origin can
 * write, so its `returnUrl` is not trusted input — taken at face value it would
 * turn Done into an open redirect. Anything that is not this origin's uploader
 * is replaced by the sibling URL derived from our own base path, which is where
 * the user wanted to go anyway.
 */
export function safeReturnUrl(returnUrl: string, origin: string): string {
  const fallback = `${origin}${uploaderPath()}`;
  let url: URL;
  try {
    url = new URL(returnUrl, origin);
  } catch {
    return fallback;
  }
  if (url.origin !== origin) return fallback;
  if (!url.pathname.startsWith(uploaderPath())) return fallback;
  return url.href;
}
