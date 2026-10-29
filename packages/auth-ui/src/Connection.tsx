import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { detectBackendDefaults, type ConnectionProbeResult, type S3Config } from '@sparcd/types';
import { BrandSwitcher } from './BrandSwitcher';
import { OfflineBanner } from './OfflineBanner';
import { useOnline } from './useOnline';
import backgroundImage from './assets/sanimalBackground.jpg';

export type ConnectionProps = {
  /** Shown in the chrome, e.g. "Uploader" → "SPARC'd · Uploader". */
  toolName: string;
  /** Pre-fill — a prior connection's remembered non-secret fields, a
   *  dev-only endpoint override, or both. Callers never pass a secretKey
   *  here; the field always starts blank regardless. */
  initialConfig?: Partial<S3Config>;
  /** `remember` reflects the "Remember me" checkbox at submit time — the
   *  caller decides what to persist (never the secret key) based on it. */
  onConnect: (config: S3Config, remember: boolean) => void;
  /** Initial state for Remember when there is no remembered connection. */
  defaultRemember?: boolean;
  /** When provided and the browser is online, a read-only connectivity/
   *  credential check runs before `onConnect` — see `testConnection` in
   *  `@sparcd/s3-safe` (#589). Skipped entirely while offline, preserving
   *  today's optimistic-accept behavior for deferred/offline login. */
  onTestConnection?: (config: S3Config, signal?: AbortSignal) => Promise<ConnectionProbeResult>;
  /** When provided, offers a secondary "Login later" action so a caller can
   *  let someone proceed without a connection until one is actually needed. */
  onSkip?: () => void;
  /** Drops the full-screen background/centering so the form can be dropped
   *  into a caller's own layout (e.g. mid-wizard, asking to connect only once
   *  a step needs it) instead of taking over the whole viewport. */
  embedded?: boolean;
};

const fieldLabel = 'block font-[600] text-[11px] tracking-[0.16em] uppercase text-inkSoft mb-1.5';
const textInput =
  'w-full bg-paper border border-rule px-3 py-2 text-[14px] font-mono text-ink ' +
  'placeholder:text-inkMute focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-accent focus-visible:outline-offset-2';

/**
 * The shared credentials/connection screen for every SPARC'd JS tool. Three
 * fields — endpoint, access key, secret key — with region / path-style /
 * secure inferred from the endpoint and exposed only behind "Advanced".
 * Parameterized solely by `toolName`.
 */
export function Connection({
  toolName,
  initialConfig,
  onConnect,
  defaultRemember = false,
  onTestConnection,
  onSkip,
  embedded,
}: ConnectionProps) {
  const rememberHelpId = useId();
  const [endpoint, setEndpoint] = useState(initialConfig?.endpoint ?? '');
  const [accessKey, setAccessKey] = useState(initialConfig?.accessKey ?? '');
  const [secretKey, setSecretKey] = useState(initialConfig?.secretKey ?? '');
  // Reflects reality by default: pre-filled fields mean a connection is
  // already being remembered, so the box starts checked to match — not an
  // opt-in surprise for anyone already relying on the pre-fill today.
  const [remember, setRemember] = useState(!!initialConfig?.endpoint || defaultRemember);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Overrides are undefined until the user explicitly sets one.
  const [regionOverride, setRegionOverride] = useState<string | undefined>(initialConfig?.region);
  const [pathStyleOverride, setPathStyleOverride] = useState<boolean | undefined>(
    initialConfig?.forcePathStyle,
  );
  const [secureOverride, setSecureOverride] = useState<boolean | undefined>(initialConfig?.secure);
  // What `endpoint` was the last time the overrides above were resolved
  // against it (see syncOverridesToEndpoint). Starts equal to the prefilled
  // endpoint so a remembered override still applies until the endpoint is
  // actually touched.
  const [lastSyncedEndpoint, setLastSyncedEndpoint] = useState(initialConfig?.endpoint ?? '');

  const inferred = useMemo(() => detectBackendDefaults(endpoint || 'localhost'), [endpoint]);
  const region = regionOverride ?? inferred.region;
  const forcePathStyle = pathStyleOverride ?? inferred.forcePathStyle;
  const secure = secureOverride ?? inferred.secure;

  // navigator.onLine has real false-offline cases (VPNs, unusual adapters,
  // captive portals) — hard-disabling on it would lock out a user with a
  // perfectly working connection, no override. Only used for the advisory
  // banner/tooltip below; a real attempt failing is a better failure mode.
  const online = useOnline();
  const canConnect = endpoint.trim() && accessKey.trim() && secretKey.trim();

  // The page itself may be served over HTTPS (GitHub Pages, etc.) even when
  // the configured endpoint resolves to plain HTTP — browsers block that as
  // mixed content before any request leaves, with nothing for the app to
  // catch or translate into an error. Checked eagerly, not on failure.
  const pageIsSecure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  // Explicit schemes take precedence over the Secure setting in endpointUrl.
  const trimmedEndpoint = endpoint.trim();
  const endpointIsSecure = /^https?:\/\//i.test(trimmedEndpoint)
    ? /^https:\/\//i.test(trimmedEndpoint)
    : secure;
  const showMixedContentWarning = online && pageIsSecure && !endpointIsSecure;

  // Set while `onTestConnection` is awaited. The whole form is disabled for
  // the duration (not just the Connect button) — that alone rules out a
  // second submission landing while the first is still in flight, so no
  // stale result can ever apply to values the user has since changed.
  const [pending, setPending] = useState(false);
  const [probeFailure, setProbeFailure] = useState<Extract<ConnectionProbeResult, { ok: false }> | null>(
    null,
  );
  // StrictMode double-invokes effects in dev (mount → cleanup → mount), so
  // the ref has to be re-armed on mount too, not just cleared on unmount —
  // otherwise that first synthetic cleanup leaves it permanently false.
  const mountedRef = useRef(true);
  const probeControllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      probeControllerRef.current?.abort();
    };
  }, []);

  function probeFailureMessage(result: Extract<ConnectionProbeResult, { ok: false }>): string {
    switch (result.category) {
      case 'unreachable':
        return `Couldn't reach ${endpoint.trim() || 'the endpoint'}. Check the address, then try again.`;
      case 'credentials-rejected':
        return 'The server rejected this access key and secret key. Check them and try again.';
      case 'probe-denied':
        return (
          "Unable to confirm your credentials. The server denied this check, which needs " +
          "bucket-listing permission. Confirm your credentials, or ask an administrator to " +
          "check your account's permissions and check bucket permissions."
        );
      case 'clock-skew':
        return (
          "Please make sure your computer's time is correct — an incorrect clock prevents " +
          'server requests from being successful. Fix it, then try logging in again.'
        );
      case 'interrupted':
        return 'Unable to check your credentials — the request was interrupted. Try logging in again.';
      case 'unexpected':
        return (
          `Something went wrong talking to the server${result.detail ? ` (${result.detail})` : ''}. ` +
          'Try again, and contact an administrator if it keeps happening.'
        );
    }
  }

  // A remembered secure/path-style/region override only means anything for
  // the endpoint it was saved for (#596) — otherwise it silently outlives
  // the endpoint it came from, e.g. a stale local-MinIO "secure: false"
  // surviving a later connection to a real HTTPS endpoint. Resolved here
  // against the current endpoint, and only called on blur and at submit —
  // never on every keystroke, so Advanced's fields don't flicker mid-edit.
  // Returns the resolved values directly rather than relying on the state
  // setters below having landed by the time the caller reads them.
  function syncOverridesToEndpoint() {
    const trimmed = endpoint.trim();
    if (trimmed === lastSyncedEndpoint) {
      return { region: regionOverride, forcePathStyle: pathStyleOverride, secure: secureOverride };
    }
    setLastSyncedEndpoint(trimmed);
    const resolved =
      trimmed === (initialConfig?.endpoint ?? '')
        ? {
            region: initialConfig?.region,
            forcePathStyle: initialConfig?.forcePathStyle,
            secure: initialConfig?.secure,
          }
        : { region: undefined, forcePathStyle: undefined, secure: undefined };
    setRegionOverride(resolved.region);
    setPathStyleOverride(resolved.forcePathStyle);
    setSecureOverride(resolved.secure);
    return resolved;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canConnect || pending) return;
    const resolved = syncOverridesToEndpoint();
    const config: S3Config = {
      endpoint: endpoint.trim(),
      region: resolved.region ?? inferred.region,
      accessKey: accessKey.trim(),
      secretKey: secretKey.trim(),
      forcePathStyle: resolved.forcePathStyle ?? inferred.forcePathStyle,
      secure: resolved.secure ?? inferred.secure,
    };

    // Offline: skip the probe entirely and keep today's optimistic accept —
    // this is purely additive for the online case.
    if (!online || !onTestConnection) {
      onConnect(config, remember);
      return;
    }

    setProbeFailure(null);
    setPending(true);
    const controller = new AbortController();
    probeControllerRef.current = controller;
    let result: ConnectionProbeResult;
    try {
      result = await onTestConnection(config, controller.signal);
    } catch {
      result = controller.signal.aborted
        ? { ok: false, category: 'interrupted' }
        : { ok: false, category: 'unexpected' };
    } finally {
      if (probeControllerRef.current === controller) probeControllerRef.current = null;
      if (mountedRef.current) setPending(false);
    }
    if (!mountedRef.current) return;
    if (result.ok) {
      onConnect(config, remember);
    } else {
      setProbeFailure(result);
    }
  }

  return (
    <div
      className={
        embedded
          ? ''
          : 'min-h-screen bg-paper bg-cover bg-center flex items-center justify-center p-6'
      }
      style={embedded ? undefined : { backgroundImage: `url(${backgroundImage})` }}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-[440px] bg-panel border border-rule p-8"
        aria-label={`Connect to SPARC'd · ${toolName}`}
      >
        <div className="-ml-1.5 mb-1">
          <BrandSwitcher toolName={toolName} />
        </div>
        <p className="font-body text-[14px] text-inkSoft mb-6">
          Connect to an S3-compatible endpoint to begin.
        </p>

        <div className="mb-4 space-y-2">
          <OfflineBanner message="You're offline — connecting needs a network connection." />
          {showMixedContentWarning && (
            <div
              role="status"
              data-testid="mixed-content-warning"
              className="border border-warn/40 bg-paper px-3 py-2.5 font-body text-[13px] text-warn"
            >
              This page is loaded over HTTPS, so connecting to a plain HTTP endpoint will be
              blocked by the browser. Check the endpoint's scheme under Advanced.
            </div>
          )}
          {probeFailure && (
            <div
              role="alert"
              data-testid="connection-probe-failure"
              className="border border-warn/40 bg-paper px-3 py-2.5 font-body text-[13px] text-warn"
            >
              {probeFailureMessage(probeFailure)}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <label htmlFor="endpoint" className={fieldLabel}>
              Endpoint
            </label>
            <input
              id="endpoint"
              name="endpoint"
              className={textInput}
              placeholder="host[:port] or https://host"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              onBlur={() => syncOverridesToEndpoint()}
              autoComplete="url"
              spellCheck={false}
              disabled={pending}
            />
          </div>
          <div>
            <label htmlFor="accessKey" className={fieldLabel}>
              Access key
            </label>
            <input
              id="accessKey"
              name="accessKey"
              className={textInput}
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              autoComplete="username"
              spellCheck={false}
              disabled={pending}
            />
          </div>
          <div>
            <label htmlFor="secretKey" className={fieldLabel}>
              Secret key
            </label>
            <input
              id="secretKey"
              name="secretKey"
              type="password"
              className={textInput}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              autoComplete="current-password"
              disabled={pending}
            />
          </div>
          <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
            <input
              type="checkbox"
              className="w-4 h-4 accent-accent"
              checked={remember}
              aria-describedby={rememberHelpId}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={pending}
            />
            Remember endpoint &amp; access key on this device
          </label>
          <p id={rememberHelpId} className="font-body text-[13px] text-inkMute italic">
            (Don't set remember endpoint &amp; access key if on a public computer)
          </p>
        </div>

        <button
          type="button"
          className="mt-5 text-[14px] font-body text-inkSoft hover:text-ink underline underline-offset-4 decoration-rule"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {advancedOpen ? '− Advanced' : '+ Advanced'}
        </button>

        {advancedOpen && (
          <div className="mt-4 space-y-4 border-t border-ruleSoft pt-4">
            <p className="font-body text-[13px] text-inkMute">
              Inferred from the endpoint. Override only if your backend differs.
            </p>
            <div>
              <label htmlFor="region" className={fieldLabel}>
                Region
              </label>
              <input
                id="region"
                className={textInput}
                value={region}
                onChange={(e) => setRegionOverride(e.target.value)}
                spellCheck={false}
                disabled={pending}
              />
            </div>
            <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent"
                checked={forcePathStyle}
                onChange={(e) => setPathStyleOverride(e.target.checked)}
                disabled={pending}
              />
              Force path-style addressing (MinIO)
            </label>
            <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent"
                checked={secure}
                onChange={(e) => setSecureOverride(e.target.checked)}
                disabled={pending}
              />
              Secure (HTTPS)
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={!canConnect || pending}
          title={!online ? "You're offline" : undefined}
          className="mt-7 w-full bg-ink text-paper border border-ink px-4 py-2 text-[14px] font-body font-[600] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-inkSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          {pending ? 'Connecting…' : 'Connect'}
        </button>

        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={pending}
            className="mt-3 w-full text-[13px] font-body text-inkSoft hover:text-ink underline underline-offset-4 decoration-rule disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Login later
          </button>
        )}
      </form>
    </div>
  );
}
