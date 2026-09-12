// Display formatting for the full ISO 8601 UTC timestamps stored in media.csv
// col 4 (`2026-09-11T13:24:00.000Z`). Construct a local date from its written
// fields so formatting does not shift what a researcher sees across timezones;
// Intl then supplies the browser's language-specific order and punctuation.

export type DateFormat = 'long' | 'short' | 'numeric' | 'iso-local';
export type TimeFormat = '24h' | '24h-seconds' | '12h' | '12h-seconds';

function localDateFromIso(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const [hours = 0, minutes = 0, seconds = 0] = iso.slice(11, 19).split(':').map(Number);
  return new Date(y, m - 1, d, hours, minutes, seconds);
}

/** Formats the date in the browser's locale, except for the portable ISO local form. */
export function formatDate(iso: string, fmt: DateFormat, locale?: string | string[]): string {
  if (fmt === 'iso-local') {
    const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
    return `${y}-${m}-${d}`;
  }
  const options: Intl.DateTimeFormatOptions =
    fmt === 'long'
      ? { year: 'numeric', month: 'long', day: 'numeric' }
      : fmt === 'short'
        ? { year: 'numeric', month: 'short', day: 'numeric' }
        : { year: 'numeric', month: 'numeric', day: 'numeric' };
  return new Intl.DateTimeFormat(locale, options).format(localDateFromIso(iso));
}

/** Formats the time in the browser's locale, with the selected clock and precision. */
export function formatTime(iso: string, fmt: TimeFormat, locale?: string | string[]): string {
  const seconds = fmt === '24h-seconds' || fmt === '12h-seconds';
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: fmt === '24h' || fmt === '24h-seconds' ? 'h23' : 'h12',
  }).format(localDateFromIso(iso));
}

export function formatDateTime(
  iso: string,
  dateFmt: DateFormat,
  timeFmt: TimeFormat,
  locale?: string | string[],
): string {
  return `${formatDate(iso, dateFmt, locale)} ${formatTime(iso, timeFmt, locale)}`;
}
