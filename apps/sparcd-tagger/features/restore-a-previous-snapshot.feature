# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/components/SnapshotsDialog.tsx, src/sections/Recovery.tsx, src/lib/s3.ts — listSnapshots/listCollectionSnapshots, src/lib/sync.ts — runRestore, src/lib/syncRunner.ts).

@unmapped
Feature: Recover a previous state of an upload

  """
  As-built flow: every sync and every restore first files an immutable copy of
  the upload's stored files. Those copies can be browsed and written back, so
  a mistaken sync is reversible and the original state of an upload is never
  destroyed. Relevant to the M2 constraint (original data cannot be destroyed
  or silently overwritten; changes are traceable).
  """

  Background:
    Given an upload is open in the tagging workspace

  @unmapped
  Scenario: The recoverable states of an upload are listed
    When the snapshots list is opened
    Then every complete snapshot of this upload is listed, most recent first
    And each entry states when it was taken, by which tagger identity, and how many files it holds

  @unmapped
  Scenario: An incomplete snapshot is never offered for recovery
    Given a snapshot was interrupted before it was fully written
    Then it is not listed as recoverable
    # The manifest is written last, so a partial copy has none and is skipped.

  @unmapped
  Scenario: An upload that has never been synced says so
    Given no sync has ever been run for this upload
    When the snapshots list is opened
    Then it states that snapshots are created the first time the upload is synced

  @unmapped
  Scenario: A restore is previewed before anything is written
    When a snapshot is chosen for restore
    Then it is compared against the currently stored files without writing anything
    And the files it would rewrite are listed
    And where the pre-restore snapshot would be filed is shown

  @unmapped
  Scenario: A restore is gated exactly like a sync
    Given a snapshot has been chosen
    Then a restore cannot be run without a tagger identity
    And while the dry-run setting is on, running it reports that nothing was written

  @unmapped
  Scenario: The state being replaced is itself preserved
    Given the dry-run setting has been switched off
    When a snapshot is restored
    Then the current stored files are first copied to a new snapshot filed under the restoring identity
    And only then are the snapshot's versions written back in place

  @unmapped
  Scenario: A restore writes against the files it re-reads, not the previewed ones
    Given the stored files changed since the restore was previewed
    When the restore is run
    Then the restore replaces the files it re-read at the moment it ran
    And every replacement still carries the precondition that catches a change made mid-write
    # Corrected against the app. The file previously claimed "a conflict is
    # reported and nothing is written". A restore re-loads the canonical files
    # when it runs and takes its IfMatch against THAT read, so a change landing
    # between the preview and the run is overwritten, not refused. Only a change
    # arriving during the write sequence itself is caught. Unlike a sync, a
    # restore has no grounded-base check. See CORRECTIONS.md.

  @unmapped
  Scenario: A snapshot identical to the current state is not rewritten
    Given the chosen snapshot matches the currently stored files
    Then the restore reports that there is nothing to restore

  @unmapped
  Scenario: Local edits survive a restore rather than being silently dropped
    Given local edits exist for the upload
    When a snapshot is restored
    Then those local edits are left in place
    And the workspace reloads the restored files beneath them

  @unmapped
  Scenario: Snapshots can be found across a whole collection
    When the History section is opened
    Then every upload in the chosen collection that has a recoverable snapshot is listed
    And each upload's snapshots are shown with their time, identity and file count
    And choosing one opens that upload's tagging workspace with its snapshots list ready

  @unmapped
  Scenario: An unreadable upload does not hide the rest of the collection's snapshots
    Given one upload's snapshots cannot be listed
    Then the other uploads' snapshots are still listed
