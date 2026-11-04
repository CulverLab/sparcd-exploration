Feature: The figures

  Four large figures above the map say what the filters leave, each with "of"
  the unfiltered total while a filter is on. The Species table, most detected
  first, is a shortcut to each species' filter.

  Background:
    Given I have opened "Alpha Basin"

  Scenario: Four figures read the photos in view
    Then the "Photos" figure reads "11 64% tagged"
    And the "Species" figure reads "4"
    And the "Locations" figure reads "5"
    And the "Dates" figure reads "Apr 2023 – Mar 2025"
    And there are 4 figures

  Scenario: The figures count the locations with matching photos, while the table keeps every camera that ran
    When I filter species to "Coyote"
    Then the "Locations" figure reads "1 of 5"
    And the "Photos" figure reads "1 100% tagged · of 11"
    And the Locations table still lists every location with photos

  Scenario: Detections, Animals counted and Active days are read where they belong, with totals at each table's end
    Then the table ends with the totals "Photos 11, Detections 8, Active days 10"
    And the "Active days" column explains "Days with at least one photo, summed over locations"
    When I show the Species table
    Then the table ends with the totals "Detections 8, Animals counted 9, Locations 5"

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
