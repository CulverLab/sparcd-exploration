Feature: Year labels

  The years under Activity and along the effort strip are thinned to fit
  their width, so they never pile up. A month's note still gives its exact
  dates.

  @preview-4
  Scenario: Twenty years of photos label their years without piling up
    Given "Alpha Basin" also has photos from 2006
    And I have opened "Alpha Basin"
    Then the Activity year labels start at "2006" and none touch
    And the effort strip year labels start at "2006" and none touch

  @preview-4
  Scenario: On a phone the year labels still fit
    Given the screen is 390 pixels wide
    And "Alpha Basin" also has photos from 2006
    And I have opened "Alpha Basin"
    Then the Activity year labels start at "2006" and none touch
    And the effort strip year labels start at "2006" and none touch
