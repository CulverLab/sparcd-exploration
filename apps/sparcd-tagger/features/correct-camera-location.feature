# Generated for issue #279: the Tagger had no way to correct a wrongly
# recorded camera location for an upload. Mirrors the uploader's location
# picker (src/components/DeploymentPicker.tsx) — pick from the shared
# registry only, no way to create a new location from either app.

@unmapped
Feature: Correct the camera location recorded for an upload

  """
  As-built flow: cameras occasionally get logged under the wrong location.
  The tagger can correct the whole upload's recorded location by picking a
  replacement from the same registry the uploader reads — the collection's
  own list, or `Settings/locations.json` when it has none. There is no way
  to create a new location from either app. The correction
  is held alongside the original until a sync writes it: `deployments.csv` is
  replaced and every media/observation row's deployment id is rewritten.
  """

  Background:
    Given an upload is open in the tagging workspace
    And a tagger identity has been set in Settings

  @unmapped
  Scenario: The upload's location can be corrected from the shared registry
    When the change-location dialog is opened
    Then the current recorded location is shown
    And locations can be searched by name or id from the shared registry
    And there is no way to add a location that is not already in the registry
    When a different location is picked and applied
    Then the workspace toolbar shows the pending location change

  @unmapped
  Scenario: Picking the location already on file is a no-op, not a pending change
    When the change-location dialog is opened
    And the current location is picked again
    Then applying is disabled because nothing would change

  @unmapped
  Scenario: A different registry location sharing the same ID can be selected
    When the change-location dialog is opened
    And a same-id alternate location is picked and applied
    Then the workspace toolbar shows the same-id pending location change

  @unmapped
  Scenario: A pending location change can be cleared before it is synced
    Given a location change is pending
    When the pending change is cleared
    Then the workspace toolbar no longer shows a pending location change

  @unmapped
  Scenario: A pending location change is included in the sync preview
    Given a location change is pending
    When the sync dialog is opened
    Then the preview states the pending location change

  @unmapped
  Scenario: A pending location change alone marks the upload as unsynced
    Given a location change is pending
    Then the top-bar sync status shows unsynced edits
    When Browse is reopened
    Then that upload's row is marked as having unsynced edits
    # A pending location correction is local work even with no per-image
    # draft dirty — both status surfaces must reflect it (#301 review).

  @unmapped
  Scenario: A synced location change rewrites the upload and is not re-applied
    Given a location change is pending
    And the dry-run setting has been switched off
    When the sync is run live
    Then every image's deployment is the new location
    And media and observation timestamps are rebased to the new location offset
    And the workspace toolbar no longer shows a pending location change

  @unmapped
  Scenario: A session grounded before location tracking existed syncs without a false conflict
    Given a local edit has been made
    And the local session was grounded before location tracking existed
    When the sync dialog is opened
    Then no conflict is reported
