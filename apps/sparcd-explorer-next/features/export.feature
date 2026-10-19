Feature: Export the rows in view

  @US-034 @US-001
  Scenario: Locations export with coordinates at the display precision
    Given I have opened "Alpha Basin"
    When I set the precision to 2 decimals
    And I filter species to "Coyote"
    And I export CSV
    Then the file is named like "alpha-basin-<date>-locations.csv"
    And the CSV has the header "Location,Location ID,Mountain range,Latitude,Longitude,Elevation (m),Photos,Detections,Species,First photo,Last photo,Active days"
    And the CSV row for "AB02" has latitude "0.53" and longitude "-150.15"

  @US-034
  Scenario: Photos export carries coordinates even when no coordinate column is shown
    Given I have opened "Alpha Basin"
    When I show the Photos table
    And I export CSV
    Then the CSV has 11 rows
    And the CSV header ends with "Latitude,Longitude"
    And no CSV value has more than 3 decimals

  @US-001
  Scenario: UTM exports as plain integers at the display precision
    Given I have opened "Alpha Basin"
    When I switch the display to UTM
    And I export CSV
    Then the CSV header includes "UTM zone,Easting,Northing"
    And every CSV easting and northing is a plain whole number
    And the CSV row for "AB02" has UTM "5N", easting "817300" and northing "58700"
    When I set the precision to 2 decimals
    And I export CSV
    Then the CSV row for "AB02" has UTM "5N", easting "817000" and northing "59000"
    When I set the precision method to "Truncate"
    And I export CSV
    Then the CSV row for "AB02" has UTM "5N", easting "817000" and northing "58000"
