Feature: Photos whose files aren't on the server

  Some upload data lists photos whose files never reached the server. The
  explorer lists every upload folder in the background and leaves those
  photos out of every count until asked for. A file that goes missing later
  says so on its tile after one request.

  Scenario: Photos listed in the upload data but not on the server are left out until asked for
    Given "Alpha Basin" has an upload listing 2 photos whose files aren't on the server
    And I have opened "Alpha Basin"
    When I open Data checks
    Then I see "2 photos are listed in the upload data, but their files aren't on the server (1 upload)."
    And the photo count reads "11 photos"
    When I switch on "Include photos whose files are missing"
    Then the photo count reads "13 photos"
    When I show the Photos grid
    Then 2 tiles say "File not found"
    And the server was never asked for those files

  Scenario: The check's action shows those photos alone
    Given "Alpha Basin" has an upload listing 2 photos whose files aren't on the server
    And I have opened "Alpha Basin"
    When I open Data checks
    And I press "Show them" in Data checks
    Then the grid shows 2 photos
    And 2 tiles say "File not found"
    And the files filter reads "Files: not on the server"
    And the photo count reads "2 of 13 photos"
    When I clear the Files filter with its ×
    Then the photo count reads "13 photos"

  Scenario: A photo whose file goes missing later says so, after one request
    Given I have opened "Alpha Basin"
    And the photo files have been checked
    When the file "IMG0003.JPG" of "Alpha Basin" is removed from the server
    And I show the Photos grid
    Then the tile taken at "2023-04-03 12:00:00" says "File not found"
    When I open the photo taken at "2023-04-03 12:00:00"
    Then the panel says the file isn't on the server, naming "IMG0003.JPG"
    And the server was asked for "IMG0003.JPG" once
