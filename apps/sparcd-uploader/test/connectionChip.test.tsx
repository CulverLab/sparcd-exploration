import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConnectionChip } from '@sparcd/auth-ui';

const ACCESS_KEY = 'AKIAEXAMPLE1234567890';

vi.mock('../../../packages/auth-ui/src/session', () => ({
  getLiveConnection: () => ({
    endpoint: 'https://sparcd-quic-proxy-03.bio260073.projects.jetstream-cloud.org:9000',
    accessKey: ACCESS_KEY,
  }),
  loadPersistedConnection: () => null,
  subscribeSharedConnection: () => () => {},
}));

const markup = (identity?: string) =>
  renderToStaticMarkup(<ConnectionChip identity={identity} onDisconnect={() => {}} />);

describe('ConnectionChip', () => {
  it('shows the access key once, masked', () => {
    const html = markup();
    expect(html).not.toContain(ACCESS_KEY);
    expect(html).toContain('AK…90');
  });

  it('puts the full identity in a title so a truncated one stays readable', () => {
    expect(markup('schnaufer')).toContain('title="schnaufer"');
  });

  it('puts the full host in a title so a truncated one stays readable', () => {
    expect(markup()).toContain(
      'title="sparcd-quic-proxy-03.bio260073.projects.jetstream-cloud.org"',
    );
  });
});
