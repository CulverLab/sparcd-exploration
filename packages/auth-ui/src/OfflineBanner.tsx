import { useOnline } from './useOnline';

export type OfflineBannerProps = {
  /** Overrides the default message — e.g. to name what won't work here specifically. */
  message?: string;
};

/**
 * Renders nothing while online; a warning banner while offline. Shared across
 * every SPARC'd JS tool's login screen and any view that depends on the
 * network, so the same signal and wording show up everywhere.
 */
export function OfflineBanner({ message }: OfflineBannerProps) {
  const online = useOnline();
  if (online) return null;

  return (
    <div
      role="status"
      className="border border-warn/40 bg-paper px-3 py-2.5 font-body text-[13px] text-warn"
    >
      {message ?? "You're offline — actions that need the network won't work until your connection is back."}
    </div>
  );
}
