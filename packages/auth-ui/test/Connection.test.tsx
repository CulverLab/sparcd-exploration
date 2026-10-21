import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { S3Config } from '@sparcd/types';
import { Connection } from '../src/Connection';

afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

// A remembered connection to a local, plain-http MinIO — secure/forcePathStyle/
// region all deliberately differ from what detectBackendDefaults would infer
// fresh for either endpoint used below, so a passing assertion proves the
// override (or the fix dropping it) actually took effect, not a coincidence.
const REMEMBERED: Partial<S3Config> = {
  endpoint: 'minio.local:9000',
  accessKey: 'ak',
  region: 'custom-region',
  forcePathStyle: true,
  secure: false,
};

function fillSecret() {
  fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'sk' } });
}

describe('Connection — remembered override vs. the current endpoint (#596)', () => {
  it('keeps the remembered override when the endpoint is never touched', () => {
    const onConnect = vi.fn();
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={onConnect} />);
    fillSecret();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, forcePathStyle: true, region: 'custom-region' }),
      expect.anything(),
    );
  });

  it('keeps the remembered override across a blur that leaves the endpoint unchanged', () => {
    const onConnect = vi.fn();
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={onConnect} />);
    fireEvent.blur(screen.getByLabelText('Endpoint'));
    fillSecret();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, forcePathStyle: true }),
      expect.anything(),
    );
  });

  it('does not re-evaluate while still typing a new endpoint — only on blur', () => {
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: 'abc123.r2.cloudflarestorage.com' },
    });
    // Advanced reveals the live secure/forcePathStyle/region values.
    fireEvent.click(screen.getByRole('button', { name: '+ Advanced' }));
    expect((screen.getByLabelText('Secure (HTTPS)') as HTMLInputElement).checked).toBe(false);
  });

  it('drops a stale override once the endpoint is changed and blurred', () => {
    const onConnect = vi.fn();
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={onConnect} />);
    const endpointInput = screen.getByLabelText('Endpoint');
    fireEvent.change(endpointInput, { target: { value: 'abc123.r2.cloudflarestorage.com' } });
    fireEvent.blur(endpointInput);
    fillSecret();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, forcePathStyle: false, region: 'auto' }),
      expect.anything(),
    );
  });

  it('drops a stale override at submit even without a prior blur (Enter key path)', () => {
    const onConnect = vi.fn();
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={onConnect} />);
    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: 'abc123.r2.cloudflarestorage.com' },
    });
    fillSecret();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, forcePathStyle: false, region: 'auto' }),
      expect.anything(),
    );
  });

  it('does not clobber a manual override made this session on an unrelated blur', () => {
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Advanced' }));
    // The remembered secure override starts unchecked; flip it on manually.
    fireEvent.click(screen.getByLabelText('Secure (HTTPS)'));
    expect((screen.getByLabelText('Secure (HTTPS)') as HTMLInputElement).checked).toBe(true);
    // Blurring the endpoint field without changing its value must not revert
    // the choice just made back to the remembered override.
    fireEvent.blur(screen.getByLabelText('Endpoint'));
    expect((screen.getByLabelText('Secure (HTTPS)') as HTMLInputElement).checked).toBe(true);
  });
});

describe('Connection — mixed-content warning (#596)', () => {
  it.each([
    ['http://storage.example.com', true, true],
    ['https://storage.example.com', false, false],
    ['  HTTP://storage.example.com  ', true, true],
    ['  HTTPS://storage.example.com  ', false, false],
    ['storage.example.com', false, true],
    ['storage.example.com', true, false],
  ])('uses the effective scheme for %s with secure=%s', (endpoint, secure, warns) => {
    render(<Connection toolName="Uploader" initialConfig={{ endpoint, secure }} onConnect={vi.fn()} />);
    expect(screen.queryByTestId('mixed-content-warning') !== null).toBe(warns);
  });

  it('warns when the page is https and the resolved endpoint is insecure', () => {
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={vi.fn()} />);
    expect(screen.getByTestId('mixed-content-warning')).not.toBeNull();
  });

  it('says nothing once the endpoint resolves to https', () => {
    render(<Connection toolName="Uploader" onConnect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: 'wildcats.sparcd.arizona.edu' },
    });
    expect(screen.queryByTestId('mixed-content-warning')).toBeNull();
  });

  it('is suppressed while offline, since the offline banner already covers that case', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={vi.fn()} />);
    expect(screen.queryByTestId('mixed-content-warning')).toBeNull();
  });
});
