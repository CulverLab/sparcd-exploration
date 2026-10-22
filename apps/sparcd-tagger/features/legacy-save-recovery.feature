@H3
Feature: Upgrade recovery retains old Sync and snapshot-restore journals
  Background:
    Given an upload with existing identifications is open in the tagging workspace

  Scenario Outline: A pre-upgrade partial operation is recovered without its removed dialog
    When a pre-upgrade "<operation>" journal with "<status>" receipts is loaded
    Then recovery requires explicit confirmation of the connected account
    When existing pending work is adopted for this account
    Then the old journal completes without repeating an applied write
    And retained legacy intent requires explicit review
    When the conflict is reloaded and connectivity changes
    Then retained legacy intent requires explicit review
    When current storage is explicitly chosen
    Then the recovered legacy bytes and historical snapshots survive reload

    Examples:
      | operation | status  |
      | Sync      | written |
      | Sync      | pending |
      | restore   | written |
      | restore   | pending |
