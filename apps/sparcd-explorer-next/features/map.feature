Feature: The map

  Hexes show how many detections are in view. A click on a hex adds it to
  the Area filter, and "Select area" takes in every hex inside a rectangle.

  Background:
    Given I have opened "Alpha Basin"

  Scenario: Hexes show their detections at rest and list their locations on hover
    Then the map shows hexes with the counts "3" and "4"
    When I hover the hex holding "AB02"
    Then the hex note says "3 locations in this hex"
    And the hex note lists "AB02" "Cedar Draw" with 3 photos and 2 detections
    And the hex note lists "AB-03" "Juniper Flat" with 1 photos and 0 detections

  Scenario: A click on a hex filters to it, and a second click lets it go
    When I click the hex holding "AB02"
    Then the area filter reads "Area: 1 hex"
    And the hex holding "AB02" is outlined as selected
    And the photo count reads "5 of 11 photos"
    When I click the hex holding "AB02"
    Then the filter bar has no "Area" filter
    And the photo count reads "11 photos"

  Scenario: Clearing the area from the map or from the filter bar
    When I click the hex holding "AB02"
    And I press "× Clear" on the map
    Then the filter bar has no "Area" filter
    When I click the hex holding "AB01"
    Then the area filter reads "Area: 1 hex"
    When I clear the Area filter with its ×
    Then the filter bar has no "Area" filter
    And the map has no "× Clear"

  Scenario: Select area takes in the hexes inside a dragged rectangle
    When I press "Select area"
    Then "Select area" is switched on
    When I drag a rectangle over the middle of the hex holding "AB02"
    Then "Select area" is switched off
    And the area filter reads "Area: 1 hex"
    And the photo count reads "5 of 11 photos"

  Scenario: Esc or a second press cancels Select area
    When I press "Select area"
    And I press Escape
    Then "Select area" is switched off
    When I press "Select area"
    And I press "Select area"
    Then "Select area" is switched off
    And the filter bar has no "Area" filter

  @US-001
  Scenario: Exact sites are not offered on this server
    Then the map offers no "Sites" view
    And the map shows hexes with the counts "3" and "4"

  Scenario: Photos with no location are counted on the map, never placed
    Then the map says "2 photos have no location"
    When I press "2 photos have no location"
    Then the Photos table has 2 rows
    And the locations filter reads "Locations: No location set"
    And I see the note "Showing photos with no location" with Undo

  Scenario: The map keeps its view when a filter changes
    When I note where the hex holding "AB02" is
    And I filter species to "Bobcat"
    Then the hex holding "AB02" has not moved
    And the map shows hexes with the counts "1" and "3"

  Scenario: Six basemaps, each with its credit line
    Then the basemaps are "USGS Topo", "Esri Imagery", "Shaded relief", "Stewardship", "OpenStreetMap" and "Carto Light"
    And the map credit reads "Tiles · USGS The National Map"
    When I choose the "Esri Imagery" basemap
    Then the map credit reads "Tiles · Esri World Imagery"
    And no tile came from a real tile server

  Scenario: Pointing at a location in the table lights it on the map
    When I point at the Locations row "AB02"
    Then the hex holding "AB02" is lit
    When I point away from the table
    Then no hex is lit
