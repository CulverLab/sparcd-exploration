import { useMemo, useState } from 'react';
import { detectBackendDefaults, type S3Config } from '@sparcd/types';
import { BrandSwitcher } from './BrandSwitcher';
import backgroundImage from './assets/sanimalBackground.jpg';

export type ConnectionProps = {
  /** Shown in the chrome, e.g. "Uploader" → "SPARC'd · Uploader". */
  toolName: string;
  /** Pre-fill (dev-only, non-secret values in practice). */
  initialConfig?: Partial<S3Config>;
  onConnect: (config: S3Config) => void;
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
export function Connection({ toolName, initialConfig, onConnect }: ConnectionProps) {
  const [endpoint, setEndpoint] = useState(initialConfig?.endpoint ?? '');
  const [accessKey, setAccessKey] = useState(initialConfig?.accessKey ?? '');
  const [secretKey, setSecretKey] = useState(initialConfig?.secretKey ?? '');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Overrides are undefined until the user explicitly sets one.
  const [regionOverride, setRegionOverride] = useState<string | undefined>(initialConfig?.region);
  const [pathStyleOverride, setPathStyleOverride] = useState<boolean | undefined>(
    initialConfig?.forcePathStyle,
  );
  const [secureOverride, setSecureOverride] = useState<boolean | undefined>(initialConfig?.secure);

  const inferred = useMemo(() => detectBackendDefaults(endpoint || 'localhost'), [endpoint]);
  const region = regionOverride ?? inferred.region;
  const forcePathStyle = pathStyleOverride ?? inferred.forcePathStyle;
  const secure = secureOverride ?? inferred.secure;

  const canConnect = endpoint.trim() && accessKey.trim() && secretKey.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canConnect) return;
    onConnect({
      endpoint: endpoint.trim(),
      region,
      accessKey: accessKey.trim(),
      secretKey: secretKey.trim(),
      forcePathStyle,
      secure,
    });
  }

  return (
    <div
      className="min-h-screen bg-paper bg-cover bg-center flex items-center justify-center p-6"
      style={{ backgroundImage: `url(${backgroundImage})` }}
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

        <div className="space-y-4">
          <div>
            <label htmlFor="endpoint" className={fieldLabel}>
              Endpoint
            </label>
            <input
              id="endpoint"
              className={textInput}
              placeholder="host[:port] or https://host"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label htmlFor="accessKey" className={fieldLabel}>
              Access key
            </label>
            <input
              id="accessKey"
              className={textInput}
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div>
            <label htmlFor="secretKey" className={fieldLabel}>
              Secret key
            </label>
            <input
              id="secretKey"
              type="password"
              className={textInput}
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              autoComplete="off"
            />
          </div>
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
              />
            </div>
            <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent"
                checked={forcePathStyle}
                onChange={(e) => setPathStyleOverride(e.target.checked)}
              />
              Force path-style addressing (MinIO)
            </label>
            <label className="flex items-center gap-2.5 font-body text-[14px] text-ink">
              <input
                type="checkbox"
                className="w-4 h-4 accent-accent"
                checked={secure}
                onChange={(e) => setSecureOverride(e.target.checked)}
              />
              Secure (HTTPS)
            </label>
          </div>
        )}

        <button
          type="submit"
          disabled={!canConnect}
          className="mt-7 w-full bg-ink text-paper border border-ink px-4 py-2 text-[14px] font-body font-[600] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-inkSoft focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        >
          Connect
        </button>
      </form>
    </div>
  );
}
