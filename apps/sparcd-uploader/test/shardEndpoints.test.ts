import { describe, expect, it } from 'vitest';
import { parseShardEndpoints } from '../src/lib/s3';

describe('parseShardEndpoints', () => {
  it('reduces each entry to a bare origin', () => {
    const { origins, rejected } = parseShardEndpoints('https://proxy:8443, https://proxy:8444');
    expect(origins).toEqual(['https://proxy:8443', 'https://proxy:8444']);
    expect(rejected).toEqual([]);
  });

  it('accepts newline separators and drops blanks and duplicates', () => {
    const { origins } = parseShardEndpoints('https://a:1\n\n https://a:1 ,https://b:2\n');
    expect(origins).toEqual(['https://a:1', 'https://b:2']);
  });

  it('rejects anything a client would have to truncate to use', () => {
    const { origins, rejected } = parseShardEndpoints(
      [
        'https://user:pw@proxy:8443', // credentials
        'https://proxy:8443/bucket', // path
        'https://proxy:8443/?x=1', // query
        'https://proxy:8443/#frag', // fragment
        'ftp://proxy:8443', // not http(s)
        'proxy:8443', // not a URL at all
      ].join(','),
    );
    expect(origins).toEqual([]);
    expect(rejected).toHaveLength(6);
  });

  it('keeps a trailing-slash origin, which truncates to nothing', () => {
    expect(parseShardEndpoints('https://proxy:8443/').origins).toEqual(['https://proxy:8443']);
  });
});
