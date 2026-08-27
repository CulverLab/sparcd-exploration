// Sibling-tool URLs derived from this tool's own base path, the same way
// BrandSwitcher's `siblingTools()` does it, so the hand-off works unchanged in
// dev and on GitHub Pages. BASE_URL '/sparcd-exploration/uploader/' → family
// root '/sparcd-exploration/'.

const familyRoot = (): string => {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/[^/]+\/$/, '');
};

/** Where the uploader sends the user to tag a handed-over batch. */
export const taggerBatchUrl = (flipId: string): string =>
  `${familyRoot()}tagger/?batch=${encodeURIComponent(flipId)}`;

/** Where the tagger sends them back to, stamped into the record it reads. */
export const uploaderReturnUrl = (flipId: string): string =>
  `${import.meta.env.BASE_URL || '/'}?flip=${encodeURIComponent(flipId)}`;
