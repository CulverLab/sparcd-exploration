Feature: Open collections

  Collections open with plain progress you can cancel. One opened before
  comes straight from this device, then checks for new uploads.

  @US-031
  Scenario: Two collections open together
    Given I am signed in
    When I open "Alpha Basin" and "Bravo Flats" together
    Then the header names "Alpha Basin + 1 more"
    And the header offers "Change collections"
    And the filter bar has a "Collections" filter
    And "In view" lists photos by collection
    And the Locations table has a "Collection" column
    And the photo count reads "14 photos"

  Scenario: One collection shows no collection controls
    Given I have opened "Alpha Basin"
    Then the header names "Alpha Basin"
    And the filter bar has no "Collections" filter
    And the Locations table has no "Collection" column

  Scenario: Opening shows its steps and can be cancelled
    Given I am signed in
    And reading "Alpha Basin" is slow
    When I tick "Alpha Basin"
    And I press the open button
    Then I see "Opening Alpha Basin"
    And I see the steps "Finding uploads", "Reading data" and "Drawing the map"
    When I cancel opening
    Then I am back at the list with "Alpha Basin" ticked

  Scenario: A collection that can't be listed says so while opening
    Given I am signed in
    And the uploads of "Bravo Flats" can't be listed
    When I open "Bravo Flats" and "Alpha Basin" together
    Then I see "Bravo Flats: couldn't open"
    And I see "Access denied reading the uploads of \"Bravo Flats\""
    And I can go back to the list

  Scenario: A collection opened before reopens from this device and picks up a new upload
    Given I have opened "Alpha Basin"
    When I go back to choose collections
    Then "Alpha Basin" is marked "Opened on this device"
    When I reopen "Alpha Basin"
    Then the workspace shows without reading the photo lists again
    And the photo count reads "11 photos"
    When a new upload arrives in "Alpha Basin"
    And I check for new uploads
    Then the photo count reads "12 photos"
    And the header says "Updated just now"
