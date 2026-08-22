// View-only display adjustments for the Tag step's focus image. Copied from
// sparcd-tagger — pure presentation, never touches pixels or S3.

export type Adjustments = {
  brightness: number;
  contrast: number;
  hue: number;
  saturation: number;
};

export const NEUTRAL: Adjustments = { brightness: 50, contrast: 50, hue: 50, saturation: 50 };

export function isNeutral(a: Adjustments): boolean {
  return a.brightness === 50 && a.contrast === 50 && a.hue === 50 && a.saturation === 50;
}

export function cssFilter(a: Adjustments): string {
  const brightness =
    a.brightness <= 50 ? a.brightness * 2 : 100 + ((a.brightness - 50) / 50) * 300;
  const contrast = a.contrast * 2;
  const hue = -180 + (a.hue / 100) * 360;
  const saturate = a.saturation * 2;
  return `brightness(${brightness}%) contrast(${contrast}%) hue-rotate(${hue}deg) saturate(${saturate}%)`;
}
