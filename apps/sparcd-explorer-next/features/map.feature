Feature: The map

  Hexes show how many detections are in view. A click on a hex adds its
  locations to the Area filter, and "Select area" takes in every hex inside a
  rectangle, or in Sites mode every site whose dot is inside it. The map is
  never more exact than the Display precision.

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
    Then the area filter reads "Area: 3 locations"
    And the hex holding "AB02" is outlined as selected
    And the photo count reads "5 of 11 photos"
    When I click the hex holding "AB02"
    Then the area filter reads "Area"
    And the photo count reads "11 photos"

  Scenario: Clearing the area from the map or from its section
    When I click the hex holding "AB02"
    And I press "× Clear" on the map
    Then the area filter reads "Area"
    When I click the hex holding "AB01"
    Then the area filter reads "Area: 1 location"
    When I clear the Area filter with its ×
    Then the area filter reads "Area"
    And the map has no "× Clear"

  Scenario: Select area takes in the hexes inside a dragged rectangle
    When I press "Select area"
    Then "Select area" is switched on
    When I drag a rectangle over the middle of the hex holding "AB02"
    Then "Select area" is switched off
    And the area filter reads "Area: 3 locations"
    And the photo count reads "5 of 11 photos"

  Scenario: Select area takes only the places still in view, and an area can grow
    When I filter locations to "AB02"
    And I press "Select area"
    And I drag a rectangle over the middle of the hex holding "AB02"
    Then the area filter reads "Area: 1 location"
    And the "Locations" figure reads "1 of 5"
    When I click the hex holding "AB01"
    Then the area filter reads "Area: 1 location"
    And the hex holding "AB01" is not outlined as selected
    When I clear the Locations filter with its ×
    And I click the hex holding "AB01"
    Then the area filter reads "Area: 2 locations"
    And the hex holding "AB01" is outlined as selected
    When I click the hex holding "AB01"
    Then the area filter reads "Area: 1 location"

  Scenario: A hex with nothing in view does nothing, and taking a hex off still works
    When I click the hex holding "AB02"
    And I filter species to "Coyote"
    Then the area filter reads "Area: 1 location"
    When I click the hex holding "AB01"
    Then the area filter reads "Area: 1 location"
    And the hex holding "AB01" is not outlined as selected
    And the hex holding "AB01" says it can't be picked
    When I click the hex holding "AB02"
    Then the area filter reads "Area"

  Scenario: The Map area value counts the area's locations still in view when other filters narrow later
    When I click the hex holding "AB02"
    Then the area filter reads "Area: 3 locations"
    When I press Only on "AB03" in the locations filter
    Then the area filter reads "Area: 1 location"
    And the "Locations" figure reads "1 of 5"

  Scenario: Select area in Sites mode takes in only the sites inside the box
    When I sign in to the server that shows exact sites and open "Alpha Basin"
    And I show sites on the map
    And I press "Select area"
    And I drag a rectangle around the dot of "AB02"
    Then the area filter reads "Area: 1 location"
    And the photo count reads "3 of 11 photos"

  Scenario: Esc or a second press cancels Select area
    When I press "Select area"
    And I press Escape
    Then "Select area" is switched off
    When I press "Select area"
    And I press "Select area"
    Then "Select area" is switched off
    And the area filter reads "Area"

  @US-001
  Scenario: A coarser Display precision makes the hexes coarser, and the area stays
    When I click the hex holding "AB02"
    Then the map shows 2 hexes
    When I set the precision to 0 decimals
    Then the map shows 1 hex
    And the hex holding "AB02" is outlined as selected
    And the area filter reads "Area: 3 locations"
    And the photo count reads "5 of 11 photos"
    When I set the precision to 3 decimals
    Then the map shows 2 hexes
    And the hex holding "AB02" is outlined as selected
    And the hex holding "AB01" is not outlined as selected

  Scenario: Sites mode takes only the sites still in view, by box and by click
    When I sign in to the server that shows exact sites and open "Alpha Basin"
    And I show sites on the map
    And I filter locations to "AB02"
    And I press "Select area"
    And I drag a rectangle around the dot of "AB03"
    Then the area filter reads "Area"
    When I click the dot of "AB03"
    Then the area filter reads "Area"
    When I click the dot of "AB02"
    Then the area filter reads "Area: 1 location"
    When I click the dot of "AB02"
    Then the area filter reads "Area"

  @US-001
  Scenario: Exact sites are not offered on this server
    Then the map offers no "Sites" view
    And the map shows hexes with the counts "3" and "4"

  Scenario: Photos with no location are counted in the data checks, never placed on the map
    Then the map shows hexes with the counts "3" and "4"
    When I open Data checks
    Then I see "2 photos from 2025 have no location (ID 0000), and 1 of them is untagged."
    When I press "Show these photos" in Data checks
    Then the grid shows 2 photos
    And the locations filter reads "Locations: No location set"
    And I see the note "Showing photos with no location" with Undo

  Scenario: Pinching over the map zooms the map, not the page
    Then a hint over the map reads "Pinch to zoom · two fingers to move the map"
    When I pinch to zoom in over the map
    Then the map zoomed in step by step while the fingers moved
    And the map is zoomed in
    And the zoom ended once
    And the browser did not zoom the page
    And the map has no hint

  Scenario: A plain scroll that starts on the map pans it and leaves the page where it was
    When I note where the hex holding "AB02" sits on the map
    And I scroll over the map without pinching
    Then the hex holding "AB02" has moved up on the map
    And the map is not zoomed
    And the page stayed where it was

  Scenario: A scroll that starts off the map keeps scrolling the page as the map passes under the pointer
    When I note where the hex holding "AB02" sits on the map
    And I scroll the page down from just above the map
    Then the page kept scrolling while the map was under the pointer
    And the hex holding "AB02" sits where it did on the map

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
