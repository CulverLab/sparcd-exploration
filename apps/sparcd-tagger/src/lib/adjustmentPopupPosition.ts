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
  const popupAt = (candidate: number, candidateTop = top) => ({
    left: candidate,
    right: candidate + panel.width,
    top: candidateTop,
    width: panel.width,
    height: panel.height,
  });
  const isBlocked = (candidate: number, candidateTop = top) =>
    blocked.some((rect) => overlaps(popupAt(candidate, candidateTop), rect));
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
    const popup = popupAt(candidate);
    return blocked.reduce((area, rect) => {
      const width = Math.max(0, Math.min(popup.right, rect.right) - Math.max(popup.left, rect.left));
      const height = Math.max(0, Math.min(popup.top + popup.height, rect.top + rect.height) - Math.max(popup.top, rect.top));
      return area + width * height;
    }, 0);
  };
  const bestLeft = candidates.reduce((best, candidate) =>
    blockedOverlap(candidate) < blockedOverlap(best) ||
    (blockedOverlap(candidate) === blockedOverlap(best) && mediaOverlap(candidate) < mediaOverlap(best))
      ? candidate
      : best,
  );
  const beside = { left: bestLeft, top };
  if (blockedOverlap(bestLeft) === 0 && mediaOverlap(bestLeft) === 0) return beside;

  // Beside the media it covers something, so leave the media's band: under the
  // media when the viewport has the room, over it when it hasn't — a phone has
  // room nowhere else. Failing both, sit as low as the viewport allows, which
  // on a desktop clears the top of whichever rail it has to share.
  const under = mediaBottom + gap;
  const over = media.top - gap - panel.height;
  const sides = [bestLeft, ...candidates.filter((candidate) => candidate !== bestLeft)];
  for (const candidateTop of [under, over]) {
    if (candidateTop < gutter || candidateTop + panel.height > viewport.height - gutter) continue;
    const side = sides.find((candidate) => !isBlocked(candidate, candidateTop));
    if (side !== undefined) return { left: side, top: candidateTop };
  }
  return { left: bestLeft, top: Math.max(gutter, Math.min(under, viewport.height - panel.height - gutter)) };
}
