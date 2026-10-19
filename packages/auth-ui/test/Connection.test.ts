import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Connection } from '../src/Connection';

const render = (labels?: { accessKey?: string; secretKey?: string }) =>
  renderToStaticMarkup(createElement(Connection, { toolName: 'Test', onConnect: () => {}, labels }));

describe('Connection labels', () => {
  it('reads "Access key" and "Secret key" by default', () => {
    const html = render();
    expect(html).toContain('>Access key</label>');
    expect(html).toContain('>Secret key</label>');
  });

  it('takes caller labels for the two credentials', () => {
    const html = render({ accessKey: 'Username', secretKey: 'Password' });
    expect(html).toContain('>Username</label>');
    expect(html).toContain('>Password</label>');
    expect(html).not.toContain('Access key');
  });

  it('keeps the HTTPS setting behind Advanced', () => {
    expect(render()).not.toContain('Secure (HTTPS)');
  });
});
