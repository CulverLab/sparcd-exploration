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
