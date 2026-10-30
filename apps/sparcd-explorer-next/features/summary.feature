Feature: The figures

  Large figures above the map say what the filters leave, each with "of" the
  unfiltered total while a filter is on. The Species table, most detected
  first, is a shortcut to each species' filter.

  Background:
    Given I have opened "Alpha Basin"

  Scenario: The figures read the photos in view
    Then the "Photos" figure reads "11 64% tagged"
    And the "Detections" figure reads "8"
    And the "Species" figure reads "4"
    And the "Animals counted" figure reads "9"
    And the "Locations" figure reads "5"
    And the "Active days" figure reads "10"
    And "Active days" explains "Days with at least one photo, summed over locations"

  Scenario: The figures count the locations the Locations table lists, whatever species is picked
    When I filter species to "Coyote"
    Then the "Locations" figure reads "5 of 5"
    And the "Photos" figure reads "1 100% tagged of 11"
    And the Locations table still lists every location with photos

  Scenario: A species in the Species table filters to it, and again lets it go
    When I show the Species table
    Then the Species table lists the most detected first, each count with its bar
    When I press "Bobcat" in the Species table
    Then the species filter reads "Species: Bobcat"
    And "Bobcat" is pressed in the Species table
    When I press "Bobcat" in the Species table
    Then the species filter reads "Species"

  Scenario: The Species table's names work from the keyboard
    When I show the Species table
    And I move to "Coyote" in the Species table and press Enter
    Then the species filter reads "Species: Coyote"
