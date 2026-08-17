# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/components/SyncDialog.tsx, src/lib/sync.ts, src/lib/syncRunner.ts, src/lib/syncJournal.ts, src/lib/s3.ts, src/store.ts).

@unmapped
Feature: Publish local identifications back to the collection

  """
  As-built flow: Sync is the only action in the tagger that changes stored
  data. It always previews first, refuses to write without a tagger identity,
  refuses to write over a version it did not read, and takes an immutable
  snapshot of the previous state before replacing anything.
  """

  Background:
    Given an upload with local edits is open in the tagging workspace
    And a tagger identity has been set in Settings

  @H2 @H3
  Scenario: Synced identifications become visible to everyone with access
    Given the dry-run setting has been switched off
    When the sync is run
    Then the upload's stored image, observation and metadata files are replaced with the edited versions
    And the identifications are then readable by the other SPARC'd tools that read the same files

  @unmapped
  Scenario: Opening the sync dialog previews the change without writing anything
    When the Sync dialog is opened
    Then the pending change is computed against the currently stored files
    And nothing in the collection is written by the preview

  @unmapped
  Scenario: The preview states exactly what would change
    When the sync preview finishes
    Then it reports how many images gain, change or lose identifications
    And how many images have a corrected capture time
    And which stored files would be rewritten
    And where the pre-change snapshot would be filed

  @unmapped
  Scenario: A real write requires switching off the dry-run setting
    Given the dry-run setting is on
    Then the action offered is a dry-run, not a write
    And running it reports that nothing was written
    And switching the setting off changes the action to a real sync

  @unmapped
  Scenario: A write cannot be run without a tagger identity
    Given no tagger identity has been set
    Then the dialog states that an identity must be set in Settings first
    And the sync action is unavailable
    # The identity stamps the snapshot path and the mandatory edit comment.

  @unmapped
  Scenario: Nothing to sync is reported as such
    Given the local edits match what is already stored
    When the sync preview finishes
    Then it reports that there is nothing to sync
    And no write action is offered

  @unmapped
  Scenario: A change made elsewhere blocks the write instead of overwriting it
    Given the upload's stored files changed after this workspace loaded them
    When a sync is attempted
    Then a conflict is reported naming the file that changed
    And nothing is written
    And the local edits are left intact
    And the choice offered is to keep editing or to discard the local edits and reload the stored version

  @unmapped
  Scenario: The previous state is preserved before anything is replaced
    Given the dry-run setting has been switched off
    When the sync is run
    Then the current stored files are first copied to an immutable snapshot filed under the tagger identity and the time
    And the snapshot is only counted as recoverable once its manifest is written
    And only then are the stored files replaced

  @unmapped
  Scenario: Only the files whose contents actually change are rewritten
    When a sync is run
    Then a stored file whose new contents are identical is left untouched
    And the upload's metadata file is always rewritten, because every sync appends its edit comment

  @unmapped
  Scenario: Rows and columns the tagger does not model are preserved
    When a sync is run
    Then images and observations the local edits did not touch keep their stored values
    And columns the tagger does not use are carried through unchanged

  @unmapped
  Scenario: A completed sync leaves the workspace consistent with what was written
    Given a sync completed and wrote the changes
    Then the images whose changes were written are no longer listed as unsaved
    And any whole-upload time shift is cleared, because it is now part of the stored capture times
    And the workspace reloads the upload from the newly stored files

  @unmapped
  Scenario: The dialog cannot be dismissed while a write is in flight
    Given a sync is running
    Then the close and cancel controls are unavailable until it finishes

  @unmapped
  Scenario: A sync interrupted part-way is completed rather than restarted
    Given a previous sync wrote some but not all of the stored files
    When a sync is attempted again for that upload
    Then the outstanding writes are completed from the record of the interrupted attempt
    And the files already written are not written a second time
    And a new operation cannot begin until that record is completed or its conflict resolved
    # Reachable only after a write is interrupted mid-sequence (tab closed,
    # network dropped between two file writes). Not reachable by normal use.

  @unmapped
  Scenario: A store that cannot guarantee safe replacement is refused
    Given the connected store does not honour conditional replacement
    When a sync is attempted
    Then the sync is refused with an explanation
    And the stored files are left untouched
    # Corrected against the app: the pre-change snapshot is written BEFORE the
    # first conditional replacement is attempted, so a refused sync does leave
    # a snapshot behind — only the canonical files are untouched. The earlier
    # wording ("nothing is written") was wrong. See CORRECTIONS.md.
    # Depends on the S3-compatible backend in use; not reachable against a
    # store that supports conditional writes.

  @unmapped
  Scenario: The workspace reports its sync state at a glance
    Then the header shows whether the upload is local-only, has unsynced edits, is syncing, is synced, is in conflict, was a dry-run, or errored
    And the state is distinguishable by shape and glyph, not by colour alone
