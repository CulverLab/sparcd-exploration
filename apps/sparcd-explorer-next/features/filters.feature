Feature: Filter the photos in view

  The filters live in a sidebar, one section each in a fixed order. Each
  section shows its value in plain words and, while on, its own ×. Reset sits
  in a fixed place, and Undo takes its place for a few seconds.

  Background:
    Given I have opened "Alpha Basin"

  Scenario: A filter shows its value in its section and clears with its ×
    Then the sidebar sections read "Species", "Locations", "Dates", "Map area", "Mountain range" and "Elevation"
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
    Then the species filter reads "Species: Deer (Mule), Gray Fox, untagged photos"
    When I clear the Species filter with its ×
    And I untick "Untagged photos" in the species filter
    Then the species filter reads "Species: no untagged photos"
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

  Scenario: The locations list does the same when its section closes it
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

  Scenario: Unticking a mountain range keeps the photos with no location, and Only on a range drops them
    When I open the mountain range filter
    Then the mountain range filter lists "AB-, AB0, No location set"
    When I untick "AB0" in the mountain range filter
    Then the mountain range filter reads "Mountain range: AB-, No location set"
    And the photo count reads "3 of 11 photos"
    When I press Only on "AB0" in the mountain range filter
    Then the mountain range filter reads "Mountain range: AB0"
    And the photo count reads "8 of 11 photos"
    When I press Only on "No location set" in the mountain range filter
    Then the mountain range filter reads "Mountain range: No location set"
    And the photo count reads "2 of 11 photos"

  Scenario: Hiding a species and picking years
    When I hide the species "Bobcat"
    Then the species filter reads "Species: all but Bobcat"
    And the photo count reads "8 of 11 photos"
    When I clear the Species filter with its ×
    And I pick the year 2024 in the dates filter
    Then the dates filter reads "Dates: 2024"
    And the photo count reads "5 of 11 photos"

  Scenario: The year buttons in the Dates section pick years in place
    When I press the year 2024 in the Dates section
    Then the dates filter reads "Dates: 2024"
    And the photo count reads "5 of 11 photos"
    When I press the year 2024 in the Dates section
    Then the dates filter reads "Dates"

  Scenario: Reset clears every filter, and Undo in its place brings them back
    When I filter species to "Bobcat"
    And I pick the year 2024 in the dates filter
    And I press "Reset filters"
    Then the photo count reads "11 photos"
    And Undo has taken Reset's place, with the focus on it
    When I press Undo
    Then the species filter reads "Species: Bobcat"
    And the dates filter reads "Dates: 2024"
    And the photo count reads "1 of 11 photos"
    And "Reset filters" is back in its place

  Scenario: Reset clears the Photos tag switch, and Undo brings it back
    When I show the Photos grid
    Then "Reset filters" is disabled
    When I choose "Tagged" in the Photos switch
    Then the grid shows 7 photos
    When I press "Reset filters"
    Then the Photos switch reads "All"
    And the grid shows 11 photos
    When I press Undo
    Then the Photos switch reads "Tagged"
    And the grid shows 7 photos

  Scenario: Undo running out with the focus on it hands the focus to the Filters button
    When I filter species to "Bobcat"
    And I press "Reset filters"
    Then Undo has taken Reset's place, with the focus on it
    When Undo runs out
    Then the focus is on the Filters button

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

  Scenario: Turning a filter on and off moves nothing
    When I note where the figures, the map and the tables' tab row are
    And I filter species to "Bobcat"
    Then the figures, the map and the tables' tab row have not moved
    When I clear the Species filter with its ×
    Then the figures, the map and the tables' tab row have not moved

  Scenario: Hiding the sidebar is remembered, and changes only the main area's width
    When I note where the figures, the map and the tables' tab row are
    And I hide the sidebar
    Then the sidebar is hidden
    And the figures, the map and the tables' tab row are only wider
    When I reload and reopen "Alpha Basin"
    Then the sidebar is hidden
    When I show the sidebar
    And I reload and reopen "Alpha Basin"
    Then the sidebar is shown

  Scenario: While the sidebar is hidden, the Filters count and Reset sit beside the Filters button
    When I filter species to "Bobcat"
    And I hide the sidebar
    Then the Filters button counts 1 on, named "Filters, 1 on: Species"
    And "Reset filters" sits right after the Filters button
    When I press "Reset filters"
    Then the photo count reads "11 photos"
    And Undo has taken Reset's place, with the focus on it
    When I press Undo
    Then the species filter reads "Species: Bobcat"

  Scenario: On a phone the filters open in a sheet, and nothing scrolls sideways
    Given the screen is 390 pixels wide
    Then the page does not scroll sideways
    When I open the Filters sheet
    Then the page does not scroll sideways
    When I filter species to "Bobcat"
    Then the sheet's button reads "Show 4 photos"
    And the Filters button counts 1 on, named "Filters, 1 on: Species"
    When I press "Show 4 photos"
    Then the Filters sheet is closed
    And the page does not scroll sideways

  Scenario: On a phone nothing behind the Filters sheet, or behind a picker over it, takes the focus
    Given the screen is 390 pixels wide
    When I open the Filters sheet
    Then only the Filters sheet takes the focus
    When I open the species filter
    Then only the Species picker takes the focus
    When I press Escape
    Then the focus is on the Species section
    And only the Filters sheet takes the focus
    When I press Escape
    Then the Filters sheet is closed
    And the focus is on the Filters button

  Scenario: The top bar and the sidebar stay in view while the page scrolls
    When I scroll down to the table
    Then the top bar and the sidebar are still in view
    And the table's controls sit just under the top bar, on one line
