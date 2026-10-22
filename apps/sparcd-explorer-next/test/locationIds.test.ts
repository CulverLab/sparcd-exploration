import { describe, expect, it } from 'vitest';
import { isNoLocation, mountainRange, normalizeLocationId } from '../src/data';

describe('location ID rules', () => {
  it('treats 0000 and empty as no location', () => {
    expect(isNoLocation('0000')).toBe(true);
    expect(isNoLocation('')).toBe(true);
    expect(isNoLocation('  ')).toBe(true);
    expect(isNoLocation('0001')).toBe(false);
  });

  it('normalizes IDs that differ only in case or punctuation', () => {
    expect(normalizeLocationId('SR-07')).toBe('SR07');
    expect(normalizeLocationId('sr 07')).toBe('SR07');
    expect(normalizeLocationId('SR07')).toBe('SR07');
  });

  it('takes the mountain range from the first three characters of the ID', () => {
    expect(mountainRange('ABC12')).toBe('ABC');
    expect(mountainRange('XY')).toBe('XY');
    expect(mountainRange('0000')).toBe('');
    expect(mountainRange('')).toBe('');
  });

  it('takes the same mountain range from IDs that differ only in case', () => {
    expect(mountainRange('pat26')).toBe('PAT');
    expect(mountainRange('PAT26')).toBe('PAT');
  });
});
