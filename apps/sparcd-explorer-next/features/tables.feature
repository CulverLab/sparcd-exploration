Feature: Tables of locations, species and photos

  Background:
    Given I have opened "Alpha Basin"

  Scenario: Locations group by location ID, with "No location set" flagged
    Then the Locations table lists "AB01", "AB02", "AB03", "AB-03" and "0000"
    And the row "0000" reads "No location set" and is flagged

  Scenario: Species read as common names
    When I show the Species table
    Then the "Common name" column lists "Bobcat", "Deer (Mule)", "Coyote" and "Gray Fox"
    And the "Scientific name" column lists "Lynx rufus"

  Scenario: The Photos list has one row per photo with its species joined
    When I show the Photos table
    Then the Photos table has 11 rows
    And one photo's species read "Bobcat, Deer (Mule)" with count 3
    When I show only untagged photos
    Then the Photos table has 4 rows
    And every row reads "Untagged"

  Scenario: The Columns editor shows, hides, moves and resets columns, and remembers them
    When I open the Columns editor
    And I hide the "Mountain range" column
    And I show the "Easting" column
    And I move "Photos" up
    Then the columns read "Location, Location ID, Activity, Coordinates, Photos, Elevation, Detections, Species, First photo, Last photo, Active days, Easting"
    When I reload and reopen "Alpha Basin"
    Then the columns read "Location, Location ID, Activity, Coordinates, Photos, Elevation, Detections, Species, First photo, Last photo, Active days, Easting"
    When I open the Columns editor
    And I reset the columns to default
    Then the columns read "Location, Location ID, Activity, Mountain range, Coordinates, Elevation, Photos, Detections, Species, First photo, Last photo, Active days"

  @US-001
  Scenario: UTM coordinates are plain integers at the display precision
    When I switch the display to UTM
    And I show the "Easting" and "Northing" columns
    Then every easting and northing is a plain whole number
    And the Coordinates of "AB02" read "5N 817300 58700"
    And the Easting and Northing of "AB02" read "817300" and "58700"
    When I set the precision to 2 decimals
    Then the Coordinates of "AB02" read "5N 817000 59000"
    And the Easting and Northing of "AB02" read "817000" and "59000"
    When I set the precision method to "Truncate"
    Then the Coordinates of "AB02" read "5N 817000 58000"
    And the Easting and Northing of "AB02" read "817000" and "58000"

  Scenario: Sorting by a column header
    When I sort by "Photos"
    Then the first row is "AB01"
    When I sort by "Photos" again
    Then the first row is "AB03"

  @preview-6
  Scenario: A location's flags say what they mean, and open their data check
    Then the "moved" flag of "AB01" explains "This location has 2 positions in the data, so the camera was probably moved."
    And the "similar ID" flag of "AB03" explains "AB-03 and AB03 look like the same location."
    When I press the "moved" flag of "AB01"
    Then Data checks opens on "AB01 sits at 2 positions, so the camera probably moved."
    When I press Escape
    Then focus is back on the "moved" flag of "AB01"

  @preview-7
  Scenario: After "Show photos", Back returns to Locations as it was
    Given the screen is 1440 pixels wide and 560 high
    When I filter species to "Bobcat"
    And I press "Show photos" on the Locations row "AB01"
    Then the view switch shows "Photos"
    And the table's controls offer "Back to Locations" before the view switch
    When I press "Back to Locations"
    Then the view switch shows "Locations"
    And the species filter reads "Species: Bobcat"
    And the locations filter reads "Locations"
    And the page is back where it was
    And there is no "Back to" button

  @preview-7
  Scenario: The Tagged switch keeps Back; the filter bar lets it go
    When I press "Show photos" on the Locations row "AB01"
    And I choose "Tagged" in the Photos switch
    Then the table's controls offer "Back to Locations" before the view switch
    When I filter species to "Bobcat"
    Then there is no "Back to" button

  @preview-7
  Scenario: A data check's action offers Back too, and Reset lets it go
    When I show the Species table
    And I open Data checks
    And I press "Show each position" in Data checks
    Then the view switch shows "Locations"
    And the table's controls offer "Back to Species" before the view switch
    When I press "Reset filters"
    Then there is no "Back to" button
