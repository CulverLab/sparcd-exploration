import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ConnectionProbeResult, S3Config } from '@sparcd/types';
import { Connection } from '../src/Connection';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('Endpoint'), {
    target: { value: 'wildcats.sparcd.arizona.edu' },
  });
  fireEvent.change(screen.getByLabelText('Access key'), { target: { value: 'ak' } });
  fireEvent.change(screen.getByLabelText('Secret key'), { target: { value: 'sk' } });
}

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

  it('keeps the warning for an explicit http endpoint even if Secure is checked', () => {
    render(<Connection toolName="Uploader" onConnect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: 'http://minio.local:9000' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Advanced' }));
    fireEvent.click(screen.getByLabelText('Secure (HTTPS)'));
    expect((screen.getByLabelText('Secure (HTTPS)') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('mixed-content-warning')).not.toBeNull();
  });

  it('does not warn for an explicit https endpoint even if Secure is unchecked', () => {
    render(<Connection toolName="Uploader" onConnect={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Endpoint'), {
      target: { value: 'https://s3.example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: '+ Advanced' }));
    fireEvent.click(screen.getByLabelText('Secure (HTTPS)'));
    expect((screen.getByLabelText('Secure (HTTPS)') as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByTestId('mixed-content-warning')).toBeNull();
  });

  it('is suppressed while offline, since the offline banner already covers that case', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    render(<Connection toolName="Uploader" initialConfig={REMEMBERED} onConnect={vi.fn()} />);
    expect(screen.queryByTestId('mixed-content-warning')).toBeNull();
  });
});

describe('Connection — credential probe (#589)', () => {
  it('calls onConnect once a successful probe resolves', async () => {
    const onConnect = vi.fn();
    const onTestConnection = vi.fn<(config: S3Config, signal?: AbortSignal) => Promise<ConnectionProbeResult>>(() =>
      Promise.resolve({ ok: true }),
    );
    render(
      <Connection toolName="Uploader" onConnect={onConnect} onTestConnection={onTestConnection} />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(onConnect).toHaveBeenCalled());
    expect(onTestConnection).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'wildcats.sparcd.arizona.edu', accessKey: 'ak' }),
      expect.any(AbortSignal),
    );
    expect(screen.queryByTestId('connection-probe-failure')).toBeNull();
  });

  it('shows a categorized message and never calls onConnect when the probe fails', async () => {
    const onConnect = vi.fn();
    const onTestConnection = vi.fn<(config: S3Config, signal?: AbortSignal) => Promise<ConnectionProbeResult>>(() =>
      Promise.resolve({ ok: false, category: 'credentials-rejected' }),
    );
    render(
      <Connection toolName="Uploader" onConnect={onConnect} onTestConnection={onTestConnection} />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(screen.getByTestId('connection-probe-failure').textContent).toContain(
        'The server rejected this access key and secret key',
      ),
    );
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('includes the safe detail code in the unexpected-failure message', async () => {
    const onTestConnection = vi.fn<(config: S3Config, signal?: AbortSignal) => Promise<ConnectionProbeResult>>(() =>
      Promise.resolve({ ok: false, category: 'unexpected', detail: 'InternalError' }),
    );
    render(
      <Connection toolName="Uploader" onConnect={vi.fn()} onTestConnection={onTestConnection} />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect(screen.getByTestId('connection-probe-failure').textContent).toContain(
        '(InternalError)',
      ),
    );
  });

  it('disables the whole form while the probe is pending, not just the button', async () => {
    const { promise, resolve } = deferred<ConnectionProbeResult>();
    const onConnect = vi.fn();
    const onTestConnection = vi.fn<(config: S3Config) => Promise<ConnectionProbeResult>>(() => promise);
    render(
      <Connection toolName="Uploader" onConnect={onConnect} onTestConnection={onTestConnection} />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Endpoint') as HTMLInputElement).disabled).toBe(true),
    );
    expect((screen.getByLabelText('Access key') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Secret key') as HTMLInputElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText('Remember endpoint & access key on this device') as HTMLInputElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Connecting…' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    resolve({ ok: true });
    await waitFor(() => expect(onConnect).toHaveBeenCalled());
    expect((screen.getByLabelText('Endpoint') as HTMLInputElement).disabled).toBe(false);
  });

  it('shows a retryable message and re-enables the form when the probe rejects', async () => {
    const onConnect = vi.fn();
    const onTestConnection = vi.fn<(config: S3Config, signal?: AbortSignal) => Promise<ConnectionProbeResult>>(
      () => Promise.reject(new Error('transport rejected')),
    );
    render(
      <Connection toolName="Uploader" onConnect={onConnect} onTestConnection={onTestConnection} />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    await waitFor(() =>
      expect(screen.getByTestId('connection-probe-failure').textContent).toContain(
        'Something went wrong talking to the server',
      ),
    );
    expect((screen.getByLabelText('Endpoint') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('aborts an in-flight probe when the connection form unmounts', async () => {
    let probeSignal: AbortSignal | undefined;
    const onTestConnection = vi.fn(
      (_config: S3Config, signal?: AbortSignal) =>
        new Promise<ConnectionProbeResult>((_resolve, reject) => {
          probeSignal = signal;
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const { unmount } = render(
      <Connection toolName="Uploader" onConnect={vi.fn()} onTestConnection={onTestConnection} />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(probeSignal).toBeDefined());

    unmount();

    expect(probeSignal?.aborted).toBe(true);
  });

  it('never runs the probe while offline — same optimistic accept as before', () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const onConnect = vi.fn();
    const onTestConnection = vi.fn<(config: S3Config, signal?: AbortSignal) => Promise<ConnectionProbeResult>>(() =>
      Promise.resolve({ ok: false, category: 'unreachable' }),
    );
    render(
      <Connection toolName="Uploader" onConnect={onConnect} onTestConnection={onTestConnection} />,
    );
    fillValidForm();
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onTestConnection).not.toHaveBeenCalled();
    expect(onConnect).toHaveBeenCalled();
  });
});

describe('Connection — a caller that checks after onConnect', () => {
  it('locks the form and reads Connecting… while busy', () => {
    render(<Connection toolName="Admin" onConnect={vi.fn()} busy />);
    fillValidForm();
    expect((screen.getByRole('button', { name: 'Connecting…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Endpoint') as HTMLInputElement).disabled).toBe(true);
  });

  it("shows the caller's error inside the form", () => {
    render(<Connection toolName="Admin" onConnect={vi.fn()} error="The login ID or secret was not accepted." />);
    expect(screen.getByRole('alert').textContent).toBe('The login ID or secret was not accepted.');
  });
});
