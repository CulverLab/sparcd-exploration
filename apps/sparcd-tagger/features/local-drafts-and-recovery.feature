@unmapped
Feature: Durable automatic work survives navigation and credential repair
  Background:
    Given an upload with existing identifications is open in the tagging workspace

  Scenario: Image and section navigation remain immediate during saving
    When an automatic save is held before its observation write
    Then image and section navigation remain available while saving
    And pending work registers a browser unload warning and blocks logout
    When the held save is released successfully
    Then all accepted work is saved and the unload warning is no longer needed

  Scenario: An upload switch flushes and waits for required writes
    When an automatic save is held before its observation write
    And another upload is requested
    Then the current upload remains active until saving succeeds
    When the held save is released successfully
    Then the requested upload opens after all writes commit

  Scenario: A failed save prevents the requested upload switch
    When an automatic save is held before its observation write
    And another upload is requested
    And the held save is released with a permission failure
    Then the failed upload remains active with retained work and Retry

  Scenario: Same-account credential repair unblocks saving without changing attribution
    When an automatic save fails after publishing observations
    Then pending work and its journal remain available with retry announced
    When credentials for a different account are offered as repair
    Then repair explains that the pending account and destination must be preserved
    When credentials for the same account are repaired
    Then the Coyote is saved exactly once and its journal is cleared
    And the repaired save retains the original actor and active upload

  Scenario: Recovery lists retained pending work for the connected account
    When an automatic save fails after publishing observations
    Then pending work and its journal remain available with retry announced
    When the Recovery section is opened
    Then this account's pending upload is listed without a snapshot chooser

  Scenario: A collection switch waits for saving even if the active view changes
    When an automatic save is held before its observation write
    And another collection is requested
    Then the current upload remains active until saving succeeds
    When the held save is released successfully
    Then the requested collection opens in Browse after all writes commit

  Scenario: Credential repair after reload does not require readable canonical files
    When an automatic save fails after publishing observations
    Then pending work and its journal remain available with retry announced
    When the pending upload is reloaded while canonical reads are denied
    Then credential repair stays available before canonical loading succeeds
    When canonical access and this account's credentials are repaired
    Then the Coyote is saved exactly once and its journal is cleared
    And the repaired save retains the original actor and active upload
