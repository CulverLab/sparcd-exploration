import { describe, expect, it } from 'vitest';
import { matching, pickAll, unpickAll } from '../../src/lib/picks';

const all = ['Alpha Basin', 'Bravo Flats', 'Alpine Meadow', 'Charlie Pond'];
const name = (c: string) => c;

describe('picking collections in the chooser', () => {
  it('shows every collection with no search, and the matches of one, ignoring case', () => {
    expect(matching(all, '  ', name)).toEqual(all);
    expect(matching(all, 'ALP', name)).toEqual(['Alpha Basin', 'Alpine Meadow']);
  });

  it('Select all adds the rows showing to what is picked, once each', () => {
    expect(pickAll(['Charlie Pond', 'Alpha Basin'], matching(all, 'alp', name))).toEqual(['Charlie Pond', 'Alpha Basin', 'Alpine Meadow']);
    expect(pickAll([], all)).toEqual(all);
  });

  it('Clear all takes only the rows showing out of what is picked', () => {
    expect(unpickAll(['Charlie Pond', 'Alpha Basin', 'Alpine Meadow'], matching(all, 'alp', name))).toEqual(['Charlie Pond']);
    expect(unpickAll(all, all)).toEqual([]);
  });
});
