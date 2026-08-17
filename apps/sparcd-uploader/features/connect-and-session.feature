# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-uploader (src/App.tsx, src/store.ts, src/components/Chrome.tsx, src/lib/s3.ts) and packages/auth-ui (Connection.tsx, ConnectionChip.tsx, session.ts).

@unmapped
Feature: Connect the uploader to storage and manage the session

  """
  As-built flow: the uploader is a static, bring-your-own-credentials page with
  no accounts of its own. Before any upload work is possible the user supplies
  an S3-compatible endpoint, an access key and a secret key. What the tool can
  see and write is decided entirely by those credentials and by the bucket's
  CORS policy — not by anything configured in the page.
  """

  Background:
    Given the uploader is open in a browser

  @unmapped
  Scenario: Nothing in the tool is reachable before a connection is made
    Given no connection has been made in this browser session
    Then the connection screen is the only thing shown
    And the New upload, History and Settings sections are not reachable

  @unmapped
  Scenario: Connecting requires an endpoint, an access key and a secret key
    Given the connection screen is shown
    When any of the endpoint, access key or secret key is empty
    Then the Connect button is disabled

  @unmapped
  Scenario: Backend details are inferred from the endpoint and can be overridden
    Given the connection screen is shown
    When an endpoint is entered
    Then the region, path-style addressing and HTTPS settings are inferred from it
    And those inferred settings are only shown under "Advanced"
    And any of them can be overridden before connecting

  @unmapped
  Scenario: The secret key is never kept on this machine
    Given a successful connection was made earlier in this browser
    When the uploader is opened again in a new page load
    Then the endpoint and access key are pre-filled from the previous connection
    And the secret key field is empty
    And the uploader stays on the connection screen until the secret is re-entered

  @unmapped
  Scenario: A second tab picks up a connection that is already open
    Given one tab of a SPARC'd tool is already connected in this browser
    When another tab of the uploader is opened
    Then it adopts the live connection without asking for the secret again
    # Live relay between tabs that are open at the same time only; nothing
    # secret is written to disk, so a tab opened after every other tab has been
    # closed must ask for the secret again.

  @unmapped
  Scenario: Disconnecting in one tab disconnects the others
    Given two tabs are connected to the same storage endpoint
    When one of them disconnects
    Then the other returns to the connection screen
    And its in-progress batch, chosen collection and chosen deployment are cleared

  @unmapped
  Scenario: The header shows which endpoint and key are in use, never the secret
    Given the uploader is connected
    Then the header shows the endpoint host and a masked form of the access key
    And it shows the uploader identity when one has been set
    And it never displays the secret key

  @unmapped
  Scenario: Reconnecting re-reads the collection and location lists
    Given the uploader has read a collection list from one connection
    When the user disconnects and connects again
    Then the collection and location lists are read again for the new connection
    And no result cached under the previous connection is reused

  @unmapped
  Scenario: The uploader identity starts from the connected access key
    Given no uploader identity has been entered
    When a connection is made
    Then the uploader identity is pre-filled with the connected access key
    And an identity carried over from a previous connection in this browser is not overwritten by connecting
    # Correction: as-built the guard is `uploaderUser || accessKey`, and both
    # disconnect paths blank the identity — so a typed identity never survives to
    # meet it. What it actually protects is the identity seeded from the previous
    # connection's remembered access key on a fresh page load.

  @unmapped
  Scenario: What the tool may read or write is decided by the credentials, not the page
    Given the uploader is connected
    Then the tool offers no list of permitted buckets of its own
    And a bucket is readable or writable only if the supplied credentials and the bucket's CORS policy allow it
    # As-built the app passes a wildcard bucket scope to its storage wrapper for
    # both reads and writes, so the wrapper's allowlist is not acting as a
    # restriction here. The wrapper still exposes no delete or copy operation.
