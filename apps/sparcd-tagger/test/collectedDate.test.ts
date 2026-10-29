import { describe, expect, it } from 'vitest';
import { extractCollectedDate } from '../src/lib/collectedDate';
const comment = (date: string) => `Santa Rita Mountains - San Pedro 15 - 6 images - uploaded 2024-01-15 - collected ${date}`;
describe('collection date from upload comments', () => {
  it.each([
    { label: 'omitted', value: undefined },
    { label: 'null', value: null },
    { label: 'zero', value: 0 },
    { label: 'number', value: 42 },
    { label: 'boolean', value: true },
    { label: 'empty array', value: [] },
    { label: 'date-like array', value: ['collected 2024-02-29'] },
    { label: 'object', value: { description: 'collected 2024-02-29' } },
    { label: 'boxed string', value: new String('collected 2024-02-29') },
  ])('treats $label descriptions as unavailable without coercion', ({ value }) => {
    expect(extractCollectedDate(value)).toBeNull();
  });
  it.each([['03-28-2000', '2000-03-28'], ['02-29-2024', '2024-02-29'], ['12-31-1999', '1999-12-31']])('normalizes documented date %s', (input, expected) => {
    expect(extractCollectedDate(`${comment(input)} - optional notes`)).toBe(expected);
  });
  it.each(['02-30-2024', '02-29-2023', '02-29-1900', '13-01-2024', '00-10-2024', '03-00-2024', '3-28-2000', '03-28-2000junk'])('rejects invalid documented date %s', input => {
    expect(extractCollectedDate(comment(input))).toBeNull();
  });
  it.each(['2024-02-29', '2023-02-28', '2000-02-29', '1999-12-31'])('preserves valid calendar date %s', value => {
    expect(extractCollectedDate(comment(value))).toBe(value);
    expect(extractCollectedDate(`${comment(value)} - optional notes`)).toBe(value);
  });
  it.each(['2024-02-30', '2023-02-29', '1900-02-29', '2024-04-31', '2024-00-10', '2024-13-01', '2024-01-00', '2024-01-32', '2024-2-01', '2024-01-01junk', '2024-01-01T00:00:00Z'])('rejects invalid/nonstandard date %s', value => {
    expect(extractCollectedDate(comment(value))).toBeNull();
  });
  it.each(['', 'No collection date', 'Not collected 2024-01-10', 'Recollected 2024-01-10', 'Notes: collected 2024-01-10'])('does not infer dates from %s', value => {
    expect(extractCollectedDate(value)).toBeNull();
  });
  it('accepts capitalization and ignores a different date in appended notes', () => {
    expect(extractCollectedDate(`${comment('2024-02-29').replace('collected', 'Collected')} - collected 2024-03-01`)).toBe('2024-02-29');
  });
});
