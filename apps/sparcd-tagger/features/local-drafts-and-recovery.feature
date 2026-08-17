# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/lib/drafts.ts, src/lib/db.ts, src/sections/Recovery.tsx, src/sections/Tag.tsx, src/lib/queries.ts).

@unmapped
Feature: Keep tagging work safe in the browser until it is synced

  """
  As-built flow: every identification, count, correction and flag is written
  to this browser's local storage as it is made. The stored collection is only
  changed by an explicit sync, so a closed tab, a crash or a lost connection
  costs no work.
  """

  Background:
    Given an upload is open in the tagging workspace

  @unmapped
  Scenario: Every edit is kept locally as it is made
    When identifications are added, corrected or removed
    Then each change is written to this browser's local store shortly after it is made
    And the workspace states how many local edits are unsaved

  @unmapped
  Scenario: Work can be forced to disk and confirmed at any moment
    When the save action is used
    Then any edit still waiting to be written is written immediately
    And the workspace confirms that the work was saved

  @unmapped
  Scenario: Closing and reopening the upload restores the work in progress
    Given local edits were made to an upload
    When the tab is closed and the same upload is opened again in that browser
    Then the local edits are shown again on their images
    And they are still listed as unsynced

  @unmapped
  Scenario: Unsynced work is listed across uploads so none is forgotten
    When the History section is opened
    Then every upload with unsaved local edits is listed
    And each entry shows how many edits it holds, how many carry a species, and when it was last edited
    And the most recently edited upload is listed first

  @unmapped
  Scenario: Unsynced work can be resumed straight from the list
    Given History lists an upload with unsaved edits
    When that upload is opened from History
    Then the tagging workspace opens on that upload with its local edits intact

  @unmapped
  Scenario: Local edits for an upload can be deliberately thrown away
    Given an upload holds unsaved local edits
    When discarding them is chosen and confirmed
    Then those local edits are removed from this browser
    And the upload reads from the stored identifications again
    And the stored collection was never changed by the discarded edits

  @unmapped
  Scenario: Discarding always asks first
    When discarding local edits is chosen
    Then the number of edits about to be discarded is stated
    And nothing is discarded unless the action is confirmed

  @unmapped
  Scenario: The version being edited against is pinned while edits are outstanding
    Given local edits are outstanding for an upload
    When the upload's stored files are refreshed in the background
    Then the version the edits were made against is not silently advanced
    And any change made elsewhere surfaces as a conflict when a sync is attempted

  @unmapped
  Scenario: History reports honestly when there is nothing outstanding
    Given no upload in this browser holds unsaved edits
    When History is opened
    Then it states that there are no unsaved local edits
