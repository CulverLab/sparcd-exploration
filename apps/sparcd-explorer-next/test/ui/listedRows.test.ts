import { describe, expect, it } from 'vitest';
import { listedRows, type PickRow } from '../../src/components/pickers/shared';

/** `name:n` for a row with n in view; a `-` in front for unticked, `~` for partly ticked. */
const row = (spec: string): PickRow => {
  const ticked = spec[0] === '-' ? false : spec[0] === '~' ? 'some' : true;
  const [key, n] = spec.replace(/^[-~]/, '').split(':');
  return { key, name: key, title: key, zero: n === '0', ticked };
};
const listed = (...specs: string[]) => listedRows(specs.map(row)).map((r) => r.key);

describe('the rows a list shows', () => {
  it('are those with something under the other filters', () => {
    expect(listed('a:3', 'b:0', 'c:1')).toEqual(['a', 'c']);
  });

  it('keep the unticked rows, the smaller side, while mostly ticked', () => {
    expect(listed('a:3', 'b:0', 'c:1', 'd:0', '-ghost:0')).toEqual(['a', 'c', 'ghost']);
  });

  it('keep the ticked rows, the smaller side, while mostly unticked', () => {
    expect(listed('one:0', '-b:0', '-c:0', '-d:0')).toEqual(['one']);
    expect(listed('one:2', '-b:0', '-c:1', '-d:0')).toEqual(['one', 'c']);
  });

  it('keep both sides when they are even', () => {
    expect(listed('a:0', 'b:0', '-c:0', '-d:0')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keep a row partly ticked, as it is a choice either way', () => {
    expect(listed('a:1', 'b:0', 'c:0', '~d:0')).toEqual(['a', 'd']);
  });

  it('leave the unticked rows with nothing in view out when everything is unticked', () => {
    expect(listed('-a:1', '-b:0', '-c:0')).toEqual(['a']);
  });

  it('can leave nothing at all', () => {
    expect(listed('a:0', 'b:0')).toEqual([]);
  });
});
