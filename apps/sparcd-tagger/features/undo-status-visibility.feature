@unmapped
Feature: Save and Undo controls appear only where applicable
  Background:
    Given an upload is open in the tagging workspace

  Scenario Outline: Exhausted Undo disappears without losing keyboard focus
    Given the save controls are viewed at width <width>
    Then the empty Undo controls are absent
    When a species is assigned for Undo visibility
    And the automatic save completes
    Then the Undo control is available
    When the final Undo is activated with "<key>"
    Then the empty Undo controls are absent
    And the save status receives keyboard focus
    When the automatically saved upload is reloaded
    Then the empty Undo controls are absent
    When a species is assigned for Undo visibility
    And the automatic save completes
    Then the Undo control is available
    Examples:
      | width | key   |
      | 1440  | Enter |
      | 390   | Space |

  Scenario: A completed Undo does not steal focus from another control
    When a species is assigned for Undo visibility
    And the automatic save completes
    And the final Undo is held while another control receives focus
    And the held save is released successfully
    Then the empty Undo controls are absent
    And the Tag tab retains keyboard focus

  Scenario: Browsing hides the entire row without interrupting background saving
    When an automatic save is held before its observation write
    And Browse is opened during the held save
    Then the global save row is absent
    When Settings is opened during the held save
    Then the save row still reports the pending write
    When Browse is opened during the held save
    And the held save is released successfully
    Then the upload finishes saving while Browse stays open
    And the global save row is absent
    When Tag is reopened from Browse
    Then the Undo control is available

  Scenario: A save failure remains recoverable after browsing with the row hidden
    When an automatic save is held before its observation write
    And Browse is opened during the held save
    And the held save is released with a permission failure
    Then Browse reports the retained save failure without the global row
    When Tag is reopened from Browse
    Then the save failure can be retried from its restored row

  Scenario Outline: Focus hides its compact exhausted Undo and retains keyboard focus
    Given the save controls are viewed at width <width>
    When a species is assigned for Undo visibility
    And the automatic save completes
    And Focus is opened for the Undo visibility check
    Then the compact Undo control is available
    When the final Undo is activated with "<key>"
    Then the empty Undo controls are absent
    And the save status receives keyboard focus
    And Focus remains open after Undo
    Examples:
      | width | key   |
      | 1440  | Enter |
      | 390   | Space |

  Scenario Outline: Failed collection reads preserve known Undo availability without consuming it
    Given the save controls are viewed at width <width>
    And recovery starts with "<state>" Undo
    When the pending upload is reloaded while canonical reads are denied
    Then Undo visibility matches its retained record while collection reads are blocked
    When canonical access and this account's credentials are repaired
    Then recovery restores the original Undo availability
    Examples:
      | width | state  |
      | 1440  | saved  |
      | 390   | saved  |
      | 1440  | absent |
      | 390   | absent |

  Scenario: A local setup failure preserves an existing Undo until setup is repaired
    Given recovery starts with "saved" Undo
    When the saved upload is reopened with local draft loading blocked
    Then the local setup failure retains a disabled Undo
    When local draft loading is restored and setup is retried
    Then recovery restores the original Undo availability
