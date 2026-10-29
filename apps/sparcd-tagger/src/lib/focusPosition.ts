/** The Focus bar describes navigation position, not tagging completion. */
export function formatFocusPosition(
  position: number,
  count: number,
  filtered: boolean,
  locale?: string | string[],
): string {
  const number = new Intl.NumberFormat(locale);
  return `Image ${number.format(position)} of ${number.format(count)} ${filtered ? 'filtered' : 'total'}`;
}
