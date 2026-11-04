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

  Scenario: Select and Clear act on the species a search finds, and say so
    When I open the species filter
    And I search the species filter for "deer"
    And I press "Clear matches" in the species filter
    Then the species filter reads "Species: all but Deer (Mule)"
    And the photo count reads "10 of 11 photos"
    When I press "Select matches" in the species filter
    Then the species filter reads "Species"
    When I press "Clear search" in the species filter
    Then the species filter offers "Select all" and "Clear all"

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

  Scenario: Select area narrows the sidebar's values and every list
    Then the species section reads "All 4 species"
    And the locations section reads "All 5 locations"
    And the mountain range section reads "All 2 mountain ranges"
    And the dates section reads "Apr 2023 to Mar 2025"
    And the elevation section reads "Any, 1,200 to 1,500 m"
    When I click the hex holding "AB01"
    Then the species section reads "2 of 4 species"
    And the locations section reads "1 of 5 locations"
    And the mountain range section reads "1 of 2 mountain ranges"
    And the dates section reads "Apr 2023 to Mar 2025"
    And the elevation section reads "Any, 1,200 m"
    And the area filter reads "Area: 1 location"
    When I open the locations filter
    Then the locations filter lists "AB01"
    And the locations filter offers no Only button
    When I open the species filter
    Then the species filter lists, in order, "Untagged photos, Bobcat, Deer (Mule)"
    When I open the mountain range filter
    Then the mountain range filter lists "AB0"
    And the mountain range filter counts "1 loc." for "AB0"

  Scenario: A species you unticked stays listed when Select area narrows it out of view
    When I hide the species "Gray Fox"
    And I click the hex holding "AB02"
    And I open the species filter
    Then the species filter lists, in order, "Untagged photos, Bobcat, Coyote, Deer (Mule), Gray Fox"
    And "Gray Fox" is unticked in the species filter
    And "Gray Fox" shows at zero in the species filter
    And "Bobcat" does not show at zero in the species filter
    When I tick "Gray Fox" in the species filter
    Then the species filter lists, in order, "Untagged photos, Bobcat, Coyote, Deer (Mule), Gray Fox"
    When I press Escape
    And I open the species filter
    Then the species filter lists, in order, "Untagged photos, Bobcat, Coyote, Deer (Mule)"
    When I press "Clear all" in the species filter
    Then the species filter reads "Species: none"
    When I press "Select all" in the species filter
    Then the species filter reads "Species"

  Scenario: A location picked alone stays listed once it has nothing in view, and the unticked rows with nothing don't
    When I filter locations to "AB02"
    And I show the Charts
    And I click the "Apr 2023" bar in the month chart
    Then the table says "No photos match these filters"
    When I open the locations filter
    Then the locations filter lists "AB01, AB02"
    And "AB02" is ticked in the locations filter
    And "AB01" is unticked in the locations filter

  Scenario: The Dates picker keeps every year in its place, and only the years in view can be picked
    When I click the hex holding "AB01"
    And I open the dates filter
    Then the dates picker offers the years "2023, 2025"
    And the months of the dates filter run from "2023-04" to "2025-03"
    And the year 2024 is disabled in the dates picker
    And the year 2023 is enabled in the dates picker
    When I press the year 2025 in the dates picker
    Then the dates filter reads "Dates: 2025"

  Scenario: Elevation spans the sites in view, and says what its filter leaves out
    When I click the hex holding "AB02"
    And I open the elevation filter
    Then the elevation filter spans "1,350 m" to "1,500 m"
    When I set the lowest elevation to 1400
    Then the elevation filter says nothing is left out
    And the photo count reads "3 of 11 photos"
    When I clear the Area filter with its ×
    And I open the elevation filter
    Then the elevation filter spans "1,200 m" to "1,500 m"
    And the elevation filter says "1 location with no elevation left out"
    When I press the "Clear" button in the elevation filter
    Then the elevation filter says nothing is left out

  Scenario: Hiding a species and picking years
    When I hide the species "Bobcat"
    Then the species filter reads "Species: all but Bobcat"
    And the photo count reads "8 of 11 photos"
    When I clear the Species filter with its ×
    And I pick the year 2024 in the dates filter
    Then the dates filter reads "Dates: 2024"
    And the photo count reads "5 of 11 photos"

  Scenario: The year buttons in the Dates picker pick years in place
    When I press the year 2024 in the dates picker
    Then the dates filter reads "Dates: 2024"
    And the photo count reads "5 of 11 photos"
    When I press the year 2024 in the dates picker
    Then the dates filter reads "Dates"

  Scenario: A year and a range never stand together, and a From after To swaps them
    When I show the Charts
    And I drag the strip from "Jan 2024" to "May 2024"
    And I press the year 2025 in the dates picker
    Then the dates filter reads "Dates: 2025"
    And the photo count reads "3 of 11 photos"
    When I enter "2024-01" as From in the dates filter
    Then the dates filter reads "Dates: from Jan 2024"
    When I enter "2024-05" as To in the dates filter
    Then the dates filter reads "Dates: Jan 2024 – May 2024"
    When I enter "2024-09" as From in the dates filter
    Then the dates filter reads "Dates: May 2024 – Sep 2024"
    When I press the year 2023 in the dates picker
    Then the dates filter reads "Dates: 2023"
    And the From and To of the dates filter are empty

  Scenario: Typing a year digit by digit into To doesn't swap it with From on the way
    When I enter "2024-05" as From in the dates filter
    And I enter "2024-09" as To in the dates filter
    And I type the year "2025" into To in the dates filter
    Then the dates filter reads "Dates: May 2024 – Sep 2025"

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
    And I show the Charts
    And I click "Jan 2025" on the strip
    Then the table says "No photos match these filters"
    When I press the big "Reset filters" button
    Then the photo count reads "11 photos"

  Scenario: Turning a filter on and off moves nothing
    When I note where the figures, the map and the tables' tab row are
    And I filter species to "Bobcat"
    Then the figures, the map and the tables' tab row have not moved
    When I clear the Species filter with its ×
    Then the figures, the map and the tables' tab row have not moved

  Scenario Outline: The Locations count saying more moves nothing at <width> pixels
    Given the screen is <width> pixels wide
    When I note where the figures, the map and the tables' tab row are
    And I filter species to "Coyote"
    Then the figures, the map and the tables' tab row have not moved
    And the table's count reads "5 locations, 1 with matching photos"

    Examples:
      | width |
      | 1366  |
      | 1280  |
      | 1024  |
      | 700   |

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
