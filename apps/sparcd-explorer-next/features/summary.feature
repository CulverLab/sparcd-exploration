Feature: In view

  The numbers beside the map follow every filter, and a top species is a
  shortcut to its filter.

  Background:
    Given I have opened "Alpha Basin"

  Scenario: The summary reads the photos in view
    Then "In view" reads "Locations" "5 of 5"
    And "In view" reads "Photos" "11 64% tagged"
    And "In view" reads "Detections" "8"
    And "In view" reads "Species" "4"
    And "In view" reads "Animals counted" "9"
    And "In view" reads "Active days" "10"
    And "Active days" explains "Days with at least one photo, summed over locations"

  Scenario: A top species filters to it, and again lets it go
    When I press "Bobcat" in the top species
    Then the species filter reads "Species: Bobcat"
    And "Bobcat" is pressed in the top species
    When I press "Bobcat" in the top species
    Then the species filter reads "Species"

  Scenario: The top species work from the keyboard
    When I move to "Coyote" in the top species and press Enter
    Then the species filter reads "Species: Coyote"
    And the Locations table still lists every location with photos
