import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Connection, type ConnectionLabels } from '../src/Connection';

const render = (labels?: ConnectionLabels) =>
  renderToStaticMarkup(createElement(Connection, { toolName: 'Test', onConnect: () => {}, labels }));

describe('Connection labels', () => {
  it('reads as it always has by default', () => {
    const html = render();
    expect(html).toContain('Connect to an S3-compatible endpoint to begin.</p>');
    expect(html).toContain('>Endpoint</label>');
    expect(html).toContain('placeholder="host[:port] or https://host"');
    expect(html).toContain('>Access key</label>');
    expect(html).toContain('>Secret key</label>');
    expect(html).toContain('Remember endpoint &amp; access key on this device</label>');
    expect(html).toMatch(/type="submit"[^>]*>Connect<\/button>/);
  });

  it('takes caller labels for the two credentials', () => {
    const html = render({ accessKey: 'Username', secretKey: 'Password' });
    expect(html).toContain('>Username</label>');
    expect(html).toContain('>Password</label>');
    expect(html).not.toContain('Access key');
    expect(html).toContain('>Endpoint</label>');
  });

  it('takes caller wording for the server, intro, remember box and button', () => {
    const html = render({
      endpoint: 'Server address',
      endpointPlaceholder: 'server.example.org',
      intro: 'Use the account your project lead set up for you.',
      remember: 'Remember me on this device',
      submit: 'Sign in',
    });
    expect(html).toContain('>Server address</label>');
    expect(html).toContain('placeholder="server.example.org"');
    expect(html).toContain('Use the account your project lead set up for you.</p>');
    expect(html).toContain('Remember me on this device</label>');
    expect(html).toMatch(/type="submit"[^>]*>Sign in<\/button>/);
    expect(html).not.toContain('S3-compatible');
  });

  it('keeps the HTTPS setting behind Advanced', () => {
    expect(render()).not.toContain('Secure (HTTPS)');
  });
});
