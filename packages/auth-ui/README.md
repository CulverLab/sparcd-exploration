# Shared connection session

`src/session.ts` keeps credentials in memory and tab-scoped
`sparcd-connection-tab` session storage. `sparcd-connection` in local storage
contains remembered non-secret form fields only. BrandSwitcher navigation and
reload restore the tab session, not the remembered form defaults.

## Ordering and logout

Protocol 1 connects/disconnects carry a revision consisting of a logical counter
and a unique decision ID. Explicit connect/logout increments the greatest known
counter; simultaneous decisions use ID ordering to converge deterministically.
Wall-clock time and message arrival order do not decide precedence. A relayed
session keeps its original revision. Identical accepted configurations do not
notify application subscribers or interrupt work.

The shared `sparcd-connection-revision` local-storage entry contains only the
protocol, revision, and connected/disconnected flag. It is a high-water mark,
not credentials, identity, or a recoverable login. It remains after logout to
prevent a delayed reply or old tab stash from reviving the old session.
The private `__sparcdRevision` field is stored atomically inside the tab's
credential record and stripped before returning the configuration to callers.
A failed credential write cannot label an older credential record as current.

Received decisions update live memory and session storage together before
notifying subscribers. Replies come from that accepted live state, never from
a possibly stale application callback. Every subscriber shares one channel
listener, so it receives each material change once. The getter argument to
`subscribeSharedConnection` remains for source compatibility but is no longer
used as an authority.

A stale stash is rejected before an app can issue requests with it. A tab whose
credentials are superseded asks live siblings for the current version; the
non-secret revision cannot recreate credentials after every tab has closed.
When local storage is unavailable, ordering still works for received decisions
and tab-restored revisions, but a new context cannot use a shared durable
high-water mark. Session-storage failure retains in-memory behavior without
promising reload persistence. This is session coordination, not a security
boundary against scripts already running on the same origin.

## Upgrade compatibility

The credential record retains its existing configuration fields and adds its
private inline revision. A legacy same-tab stash is
migrated only when no versioned authority marker exists. Otherwise it cannot
supersede a newer connection or logout. Unversioned connection broadcasts/replies
are ignored because their freshness cannot be established; already-open older
clients must reload to propagate a new login through the versioned protocol.
Legacy logout is still honored and relayed as a versioned logout, preserving
cross-version sign-out at the cost of allowing a delayed old logout to sign
out a newer session conservatively. Do not stamp an
old reply with a new revision or automatically trust it as a new login.

## Verification

Uploader `test/session.test.ts` covers ordering, duplicate and stale replies,
logout, same-tab migration, synchronized state, and credential storage.
`features/shared-session.feature` exercises real Uploader/Tagger navigation
through the unified dev origin, refused-then-corrected endpoints, Remember
on/off, reloads, and deterministic stale-sibling delivery. The cross-tool suite
runs in the existing dev-proxy CI workflow. `CROSS_TOOL_PORT` can override its
front-end port; `UPLOADER_TEST_PORT` independently selects the mock storage
origin. Sibling test tabs always use the actual app origin, as in CI.
