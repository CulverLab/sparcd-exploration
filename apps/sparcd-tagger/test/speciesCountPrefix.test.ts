import { describe, expect, it } from 'vitest';
import {
  appendSpeciesCountDigit,
  MAX_PREFIXED_SPECIES_COUNT,
  removeSpeciesCountDigit,
  speciesCountFromPrefix,
} from '../src/lib/speciesCountPrefix';

describe('species count prefix', () => {
  it('builds a multi-digit count', () => {
    expect(appendSpeciesCountDigit(appendSpeciesCountDigit('', '1'), '5')).toBe('15');
  });

  it('ignores leading zero and caps entry at 20', () => {
    expect(appendSpeciesCountDigit('', '0')).toBe('');
    expect(appendSpeciesCountDigit('2', '1')).toBe(String(MAX_PREFIXED_SPECIES_COUNT));
  });

  it('supports backspace and an empty prefix', () => {
    expect(removeSpeciesCountDigit('15')).toBe('1');
    expect(removeSpeciesCountDigit('1')).toBe('');
    expect(speciesCountFromPrefix('')).toBeNull();
    expect(speciesCountFromPrefix('20')).toBe(20);
  });
});
