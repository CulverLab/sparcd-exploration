@unmapped
Feature: Automatic save preserves actionable S3 read diagnostics
  Background:
    Given an upload with existing identifications is open in the tagging workspace

  Scenario: An unnamed transient HEAD denial recovers during automatic saving
    Given the next canonical media HEAD fails without an S3 error code
    When Coyote is applied for automatic saving
    And the automatic save completes
    Then automatic saving does not show an access-denied error

  Scenario: A confirmed media permission denial retains actionable work
    Given the next canonical media GET is denied with AccessDenied
    When Coyote is applied for automatic saving
    Then automatic saving shows the confirmed media access-denied error
    And credentials can be repaired without discarding pending work
