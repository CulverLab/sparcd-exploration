Feature: Camera effort

  Photos per month across everything opened, under every filter but Dates,
  so the time context stays in sight while dates are picked.

  Background:
    Given I have opened "Alpha Basin"

  Scenario: Dragging across months sets Dates, and × Clear lets them go
    When I drag the strip from "Jan 2024" to "May 2024"
    Then the dates filter reads "Dates: Jan 2024 – May 2024"
    And the photo count reads "4 of 11 photos"
    And the strip marks "Jan 2024" to "May 2024"
    When I press "× Clear" on the strip
    Then the dates filter reads "Dates"
    And the photo count reads "11 photos"

  Scenario: A click picks one month, and a second click lets it go
    When I click "Jan 2024" on the strip
    Then the dates filter reads "Dates: Jan 2024"
    And the photo count reads "3 of 11 photos"
    When I click "Jan 2024" on the strip
    Then the dates filter reads "Dates"

  Scenario: The keyboard moves a cursor and Enter picks
    When I move to the strip with the keyboard
    And I press the "End" key on the strip
    And I press the "Enter" key on the strip
    Then the dates filter reads "Dates: Mar 2025"
    When I press the "ArrowLeft" key on the strip
    And I press the "ArrowLeft" key on the strip
    And I press the "Space" key on the strip
    Then the dates filter reads "Dates: Jan 2025 – Mar 2025"
    And the photo count reads "3 of 11 photos"

  Scenario: The strip follows every filter but Dates
    Then the strip shows 6 months with photos
    When I pick the year 2024 in the dates filter
    Then the strip shows 6 months with photos
    When I filter species to "Bobcat"
    Then the strip shows 3 months with photos

  Scenario: Each location's activity sits on the same months, with a note per cell
    When I point at the Activity of "AB02"
    Then I see the note "AB02 · 2024-01 to 2024-01 · 3 active days"
