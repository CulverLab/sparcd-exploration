@H2 @H3
Feature: Completed changes reach shared canonical storage automatically
  Background:
    Given an upload with existing identifications is open in the tagging workspace

  Scenario: Removing the final species stores a blank placeholder and can be undone
    When all species on an identified image are removed and automatically saved
    Then the stored removal retains a blank slot and its provenance
    When the latest automatic action is undone
    Then its original species and identifier are restored

  Scenario: A bulk species action is undone on its original targets
    When a species is assigned to a two-image selection and automatically saved
    And a different image is selected
    And the latest automatic action is undone
    Then only the bulk action's original targets are reversed

  Scenario: A bulk timestamp shift is undone on its original targets
    When a two-image selection is shifted and automatically saved
    And a different image is selected
    And the latest automatic action is undone
    Then the original timestamps and source markers are restored

  Scenario: Shared Need expert status saves without a species assignment
    When Need expert alone is automatically saved
    And the latest automatic action is undone
    Then only the expert status is reversed

  Scenario: Unsupported conditional storage refuses automatic replacement
    When storage refuses safe conditional replacement
    Then canonical data remains unchanged and recovery explains the refusal
