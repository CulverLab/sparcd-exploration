export type Rect = { left: number; right: number; top: number; width: number; height: number };

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.right && a.right > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

export function adjustmentPopupPosition(
  media: Rect,
  panel: Rect,
  viewport: { width: number; height: number },
  blocked: Rect[] = [],
) {
  const gutter = 8;
  const gap = 12;
  const maxLeft = Math.max(gutter, viewport.width - panel.width - gutter);
  const top = Math.max(gutter, Math.min(media.top, viewport.height - panel.height - gutter));
  const left = media.left - panel.width - gap;
  const isBlocked = (candidate: number) => {
    const popup = { left: candidate, right: candidate + panel.width, top, width: panel.width, height: panel.height };
    return blocked.some((rect) => overlaps(popup, rect));
  };
  if (left >= gutter && !isBlocked(left)) return { left, top };
  const right = media.right + gap;
  if (right <= maxLeft && !isBlocked(right)) return { left: right, top };

  // Neither side fits. Clamp both candidates and use the one which obscures the
  // least of the focused media. Keeping the left candidate first preserves the
  // preferred left-side placement for an exact tie.
  const candidates = [Math.max(gutter, Math.min(left, maxLeft)), Math.max(gutter, Math.min(right, maxLeft))];
  const mediaBottom = media.top + media.height;
  const panelBottom = top + panel.height;
  const verticalOverlap = Math.max(0, Math.min(panelBottom, mediaBottom) - Math.max(top, media.top));
  const mediaOverlap = (candidate: number) =>
    Math.max(0, Math.min(candidate + panel.width, media.right) - Math.max(candidate, media.left)) * verticalOverlap;
  const blockedOverlap = (candidate: number) => {
    const popup = { left: candidate, right: candidate + panel.width, top, width: panel.width, height: panel.height };
    return blocked.reduce((area, rect) => {
      const width = Math.max(0, Math.min(popup.right, rect.right) - Math.max(popup.left, rect.left));
      const height = Math.max(0, Math.min(popup.top + popup.height, rect.top + rect.height) - Math.max(popup.top, rect.top));
      return area + width * height;
    }, 0);
  };
  return {
    left: candidates.reduce((best, candidate) =>
      blockedOverlap(candidate) < blockedOverlap(best) ||
      (blockedOverlap(candidate) === blockedOverlap(best) && mediaOverlap(candidate) < mediaOverlap(best))
        ? candidate
        : best,
    ),
    top,
  };
}
