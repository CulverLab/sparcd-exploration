Feature: Data checks

  Problems in the files that change what the numbers mean, each in one plain
  sentence with one action.

  Scenario: Each check is a sentence with an action
    Given I have opened "Alpha Basin"
    When I open Data checks
    Then Data checks shows 4 problems
    And each check has exactly one button
    And I see "2 photos from 2025 have no location (ID 0000), and 1 of them is untagged."
    And I see "AB-03 and AB03 look like the same location."
    And I see "AB01 sits at 2 positions, so the camera probably moved."
    And I see "1 upload in Alpha Basin is incomplete and hidden."

  Scenario: Showing photos with no location
    Given I have opened "Alpha Basin"
    When I open Data checks
    And I press "Show these photos" in Data checks
    Then the grid shows 2 photos
    And the locations filter reads "Locations: No location set"

  Scenario: Showing each location ID separately splits a moved camera
    Given I have opened "Alpha Basin"
    When I open Data checks
    And I switch on "Show each location ID separately"
    Then the Locations table has 6 rows
    And I see "Each location ID shown separately"

  Scenario: The same location in two collections
    Given I am signed in
    When I open "Alpha Basin" and "Bravo Flats" together
    And I open Data checks
    Then I see "AB01 appears in 2 collections: Alpha Basin has Apr 2023 to Mar 2025, Bravo Flats has Feb 2025 to Feb 2025."

  Scenario: A moved camera shows each of its positions
    Given I have opened "Alpha Basin"
    When I open Data checks
    And I press "Show each position" in Data checks
    Then the Locations table has 2 rows
    And the "Location ID" column lists "AB01"
    And I see "Each location ID shown separately"

  Scenario: Near-duplicate IDs show both
    Given I have opened "Alpha Basin"
    When I open Data checks
    And I press "Show both IDs" in Data checks
    Then the Locations table has 2 rows
    And the locations filter reads "Locations: AB03, AB-03"

  Scenario: Hidden uploads are named on request
    Given I have opened "Alpha Basin"
    When I open Data checks
    And I press "Show which" in Data checks
    Then I see "2025.05.01.08.00.00_interrupted"
