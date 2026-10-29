@unmapped
Feature: Correct the recorded camera location with automatic saving
  Background:
    Given an upload is open in the tagging workspace
    And the connected account is ready for attribution

  Scenario: A location correction uses the shared registry and saves immediately
    When the change-location dialog is opened
    Then the current recorded location is shown
    And locations can be searched by name or id from the shared registry
    And there is no way to add a location that is not already in the registry
    When a different location is picked and applied
    And the upload is saved automatically
    Then every image's deployment is the new location
    And media and observation timestamps are rebased to the new location offset
    And the workspace toolbar no longer shows a pending location change

  Scenario: Picking the location already on file is a no-op
    When the change-location dialog is opened
    And the current location is picked again
    Then applying is disabled because nothing would change

  Scenario: A registry location sharing the same ID can be selected and saved
    When the change-location dialog is opened
    And a same-id alternate location is picked and applied
    And the upload is saved automatically
    Then the same-id alternate registry location is stored

  Scenario: Location Undo restores its original capture values
    When the original canonical values are recorded for Undo verification
    And the change-location dialog is opened
    And a different location is picked and applied
    And the upload is saved automatically
    And the latest automatic action is undone
    Then the original location and capture values are restored without replacing audit history

  Scenario: A browser grounded before location tracking can still save safely
    Given a local edit has been made
    And the local session was grounded before location tracking existed
    When the upload is saved automatically
    Then the automatic save completed without a false deployment conflict
