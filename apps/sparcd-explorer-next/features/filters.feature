Feature: Filter the photos in view

  The filter bar is one line. Each filter shows its own value and its own ×,
  and Reset sits at the right end with Undo.

  Background:
    Given I have opened "Alpha Basin"

  Scenario: A filter shows its value on its button and clears with its ×
    Then the filter buttons read "Species", "Locations", "Dates", "Elevation" and "Mountain range"
    And "Reset filters" is disabled
    When I filter species to "Bobcat"
    Then the species filter reads "Species: Bobcat"
    And the photo count reads "4 of 11 photos"
    When I also pick "Coyote" in the species filter
    Then the species filter reads "Species: Bobcat +1"
    When I clear the Species filter with its ×
    Then the species filter reads "Species"
    And the photo count reads "11 photos"

  Scenario: Hiding species and picking years
    When I hide the species "Bobcat"
    Then the species filter reads "Hiding: Bobcat"
    And the photo count reads "8 of 11 photos"
    When I clear the Species filter with its ×
    And I pick the year 2024 in the dates filter
    Then the dates filter reads "Dates: 2024"
    And the photo count reads "5 of 11 photos"

  Scenario: Reset clears every filter, and Undo brings them back
    When I filter species to "Bobcat"
    And I pick the year 2024 in the dates filter
    And I press "Reset filters"
    Then the photo count reads "11 photos"
    And I see the note "Filters reset" with Undo
    When I press Undo
    Then the species filter reads "Species: Bobcat"
    And the dates filter reads "Dates: 2024"
    And the photo count reads "1 of 11 photos"

  Scenario: When nothing matches, the table offers a big Reset
    When I filter species to "Coyote"
    And I pick the year 2025 in the dates filter
    Then the table says "No photos match these filters"
    When I press the big "Reset filters" button
    Then the photo count reads "11 photos"

  Scenario: On a phone the filter bar stays on one line
    Given the screen is 400 pixels wide
    When I filter species to "Bobcat"
    Then the filter bar is one line high
    And the page does not scroll sideways
    And the reset button reads "Reset"
    And the photo count is hidden

  Scenario: The header and filter bar stay in view while the page scrolls
    When I scroll down to the table
    Then the filter bar is still at the top of the screen
    And the table's column headers sit just under it
