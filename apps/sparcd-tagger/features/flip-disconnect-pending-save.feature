Feature: A local handoff prompt cannot bypass pending Tagger saves
  Background:
    Given an upload with existing identifications is open in the tagging workspace

  Scenario: An unresolved remote save keeps Disconnect unavailable
    Given the current login has two local handoffs to review
    When a completed edit loses connectivity before automatic saving
    And Disconnect is attempted from Settings while Tagger save recovery is pending
    Then the pending save blocks Disconnect without changing local handoffs
    When the connection returns
    Then the Coyote is saved without manual controls or per-edit snapshots

  Scenario: An unresolved recovery journal keeps Disconnect unavailable
    Given the current login has two local handoffs to review
    When an automatic save fails after publishing observations
    Then pending work and its journal remain available with retry announced
    And Disconnect is attempted from Settings while Tagger save recovery is pending
    Then the pending save blocks Disconnect without changing local handoffs
