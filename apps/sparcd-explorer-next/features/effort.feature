Feature: Camera effort

  Photos per month across everything opened, under every filter but Dates,
  so the time context stays in sight while dates are picked. A species
  filter doesn't change the effort; its photos are drawn inside the bars.

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

  Scenario Outline: The strip's × Clear clears Dates as the filter's × does, and Back goes with it
    When I drag the strip from "Jan 2024" to "May 2024"
    And I pick the year 2024 in the dates filter
    And I press "Show photos" on the Locations row "AB02"
    Then the table's controls offer "Back to Locations" before the view switch
    When <clear>
    Then the dates filter reads "Dates"
    And the locations filter reads "Locations: AB02"
    And there is no "Back to" button

    Examples:
      | clear                               |
      | I press "× Clear" on the strip      |
      | I clear the Dates filter with its × |

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
    And the strip draws nothing inside its bars
    When I pick the year 2024 in the dates filter
    Then the strip shows 6 months with photos
    When I click the hex holding "AB02"
    Then the strip shows 3 months with photos

  Scenario: Under a species filter the bars stay camera effort, with the species inside
    When I filter species to "Bobcat"
    Then the strip shows 6 months with photos
    And the strip draws "Bobcat" inside 3 months
    When I also pick "Deer (Mule)" in the species filter
    Then the strip draws "Bobcat, Deer (Mule)" inside 4 months

  Scenario: In Photos, the Tagged switch's photos sit inside the bars
    When I show the Photos table
    And I choose "Tagged" in the Photos switch
    Then the strip shows 6 months with photos
    And the strip draws "Tagged" inside 5 months
    When I show the Locations table
    Then the strip draws nothing inside its bars

  Scenario: Each location's activity keeps its effort, with the species inside
    When I filter species to "Coyote"
    Then the Activity of "AB01" shows 2 months with nothing inside
    And the Activity of "AB02" draws "Coyote" inside 1 month

  Scenario: Each location's activity sits on the same months, with a note per cell
    When I point at the Activity of "AB02"
    Then I see the note "AB02 · 2024-01 to 2024-01 · 3 active days"
