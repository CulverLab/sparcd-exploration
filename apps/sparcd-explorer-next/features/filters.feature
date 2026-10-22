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
    Then the species filter reads "Species: Bobcat, Coyote"
    When I clear the Species filter with its ×
    Then the species filter reads "Species"
    And the photo count reads "11 photos"

  Scenario: Every species starts ticked, untagged photos too
    When I open the species filter
    Then every row of the species filter is ticked
    And the species filter lists "Untagged photos" first, apart from the species
    And the species filter lists, in order, "Untagged photos, Bobcat, Coyote, Deer (Mule), Gray Fox"
    And the species filter reads "Species"

  Scenario: Only shows one species and unticks the rest, untagged photos too
    When I press Only on "Deer (Mule)" in the species filter
    Then "Deer (Mule)" is ticked in the species filter
    And "Bobcat" is unticked in the species filter
    And "Untagged photos" is unticked in the species filter
    And the species filter reads "Species: Deer (Mule)"
    And the photo count reads "2 of 11 photos"

  Scenario: Unticking species and untagged photos
    When I untick "Bobcat" in the species filter
    Then the species filter reads "Species: all but Bobcat"
    And the photo count reads "8 of 11 photos"
    When I untick "Coyote" in the species filter
    Then the species filter reads "Species: Deer (Mule), Gray Fox"
    When I clear the Species filter with its ×
    And I untick "Untagged photos" in the species filter
    Then the species filter reads "Species: no untagged"
    And the photo count reads "7 of 11 photos"

  Scenario: Clear all, then Select all
    When I open the species filter
    And I press "Clear all" in the species filter
    Then the species filter reads "Species: none"
    And the photo count reads "0 of 11 photos"
    And the table says "No species selected"
    When I press "Select all" in the species filter
    Then the species filter reads "Species"
    And the photo count reads "11 photos"

  Scenario: Closing a list with nothing ticked shows everything again, and Undo empties it
    When I open the species filter
    And I press "Clear all" in the species filter
    Then I see "Pick at least one species"
    When I press Escape
    Then the species filter reads "Species"
    And the photo count reads "11 photos"
    And I see the note "No species were picked, so all are shown again" with Undo
    When I press Undo
    Then the species filter reads "Species: none"
    And the table says "No species selected"
    When I press the big "Select all" button
    Then the species filter reads "Species"
    And the photo count reads "11 photos"

  Scenario: The locations list does the same when its button closes it
    When I open the locations filter
    And I press "Clear all" in the locations filter
    Then I see "Pick at least one location"
    When I close the locations filter with its button
    Then the locations filter reads "Locations"
    And I see the note "No locations were picked, so all are shown again" with Undo

  Scenario: Select all and Clear all act on the species a search finds
    When I open the species filter
    And I search the species filter for "deer"
    And I press "Clear all" in the species filter
    Then the species filter reads "Species: all but Deer (Mule)"
    And the photo count reads "10 of 11 photos"
    When I press "Select all" in the species filter
    Then the species filter reads "Species"

  Scenario: A search shows its × while it has text, and Esc clears it before closing
    When I open the species filter
    Then the species search has no "Clear search" button
    When I search the species filter for "deer"
    Then the species search shows "Clear search", at least 28 pixels square
    When I press "Clear search" in the species filter
    Then the species search is empty, with the cursor in it
    And every row of the species filter is ticked
    When I search the species filter for "deer"
    And I press Escape
    Then the species search is empty, with the cursor in it
    When I press Escape
    Then the species filter is closed

  Scenario: Only on a location
    When I press Only on "AB02" in the locations filter
    Then the locations filter reads "Locations: AB02"
    And the photo count reads "3 of 11 photos"
    When I tick "AB03" in the locations filter
    Then the locations filter reads "Locations: AB02, AB03"
    When I clear the Locations filter with its ×
    And I untick "AB03" in the locations filter
    Then the locations filter reads "Locations: all but AB03"
    And the photo count reads "10 of 11 photos"

  Scenario: Hiding a species and picking years
    When I hide the species "Bobcat"
    Then the species filter reads "Species: all but Bobcat"
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

  Scenario: Undo after a refresh puts back "only these", leaving a new location out
    When I filter locations to "AB02"
    And I press "Reset filters"
    And a new upload arrives in "Alpha Basin"
    And I check for new uploads
    Then the photo count reads "12 photos"
    When I press Undo
    Then the locations filter reads "Locations: AB02"
    And the photo count reads "3 of 12 photos"

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
    And the table's controls sit just under it, on one line
