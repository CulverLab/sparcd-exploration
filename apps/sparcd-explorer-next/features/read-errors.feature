Feature: Read errors in plain words

  Scenario: A file that can't be read is named in Data checks
    Given I am signed in
    And the photo list of the first "Alpha Basin" upload can't be read
    When I open "Alpha Basin"
    And I open Data checks
    Then I see "media.csv in upload 2023.05.01.10.00.00_fielduser of Alpha Basin couldn't be read"
    And I see "Access denied reading media.csv"
