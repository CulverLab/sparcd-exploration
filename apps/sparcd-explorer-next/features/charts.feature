Feature: Charts

  Three fixed charts of the detections in view. Each bar is a shortcut to
  its filter, by click or from the keyboard, and Reset puts everything back
  with Undo.

  Background:
    Given I have opened "Alpha Basin"
    And I show the Charts

  Scenario: Detections by species, by hour and by month
    Then the species chart reads "Bobcat 4", "Deer (Mule) 2", "Coyote 1" and "Gray Fox 1"
    And the hour chart has 24 bars with the night shaded from 19:00 to 06:00
    And the hour chart counts 2 detections at "22:00"
    And the month chart is labelled with the years "2023", "2024" and "2025"
    And the month chart counts 3 detections in "Apr 2023"

  Scenario: A species bar filters to it, and Reset then Undo
    When I click the "Bobcat" bar in the species chart
    Then the species filter reads "Species: Bobcat"
    And the "Bobcat" bar in the species chart is highlighted
    And the "Coyote" bar in the species chart is dimmed
    When I press "Reset filters"
    Then the species filter reads "Species"
    And no bar in the species chart is highlighted
    When I press Undo
    Then the species filter reads "Species: Bobcat"

  Scenario: An hour bar filters to that hour, from the keyboard too
    When I press Enter on the "22:00" bar in the hour chart
    Then the dates filter reads "Dates: hours 22:00–22:59"
    And the photo count reads "1 of 11 photos"
    And the "22:00" bar in the hour chart is highlighted
    When I press "Reset filters"
    Then the dates filter reads "Dates"
    When I press Undo
    Then the dates filter reads "Dates: hours 22:00–22:59"
    When I press Space on the "22:00" bar in the hour chart
    Then the dates filter reads "Dates"

  Scenario: A month bar sets Dates to that month
    When I click the "Jan 2024" bar in the month chart
    Then the dates filter reads "Dates: Jan 2024"
    And the photo count reads "3 of 11 photos"
    And the "Jan 2024" bar in the month chart is highlighted
    When I press "Reset filters"
    Then the dates filter reads "Dates"
    When I press Undo
    Then the dates filter reads "Dates: Jan 2024"
    When I click the "Jan 2024" bar in the month chart
    Then the dates filter reads "Dates"
