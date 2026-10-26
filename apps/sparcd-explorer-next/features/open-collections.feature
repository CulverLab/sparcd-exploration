Feature: Open collections

  Collections open with plain progress you can cancel. One opened before
  comes straight from this device, then checks for new uploads.

  @US-031
  Scenario: Two collections open together
    Given I am signed in
    When I open "Alpha Basin" and "Bravo Flats" together
    Then the header names "Alpha Basin + 1 more"
    And the header offers "Change collections"
    And the filter bar has a "Collections" filter
    And "In view" lists photos by collection
    And the Locations table has a "Collection" column
    And the photo count reads "14 photos"

  Scenario: One collection shows no collection controls
    Given I have opened "Alpha Basin"
    Then the header names "Alpha Basin"
    And the filter bar has no "Collections" filter
    And the Locations table has no "Collection" column

  Scenario: Opening shows its steps and can be cancelled
    Given I am signed in
    And reading "Alpha Basin" is slow
    When I tick "Alpha Basin"
    And I press the open button
    Then I see "Opening Alpha Basin"
    And I see the steps "Finding uploads", "Reading data" and "Drawing the map"
    When I cancel opening
    Then I am back at the list with "Alpha Basin" ticked

  Scenario: A collection that can't be listed says so while opening
    Given I am signed in
    And the uploads of "Bravo Flats" can't be listed
    When I open "Bravo Flats" and "Alpha Basin" together
    Then I see "Bravo Flats: couldn't open"
    And I see "Access denied reading the uploads of \"Bravo Flats\""
    And I can go back to the list

  Scenario: A collection opened before reopens from this device and picks up a new upload
    Given I have opened "Alpha Basin"
    When I go back to choose collections
    Then "Alpha Basin" is marked "Opened on this device"
    When I reopen "Alpha Basin"
    Then the workspace shows without reading the photo lists again
    And the photo count reads "11 photos"
    When a new upload arrives in "Alpha Basin"
    And I check for new uploads
    Then the photo count reads "12 photos"
    And the header says "Updated just now"

  Scenario: Signing in as someone else while a collection opens never shows the first account's data
    Given I am signed in
    And the explorer is open in a second tab
    And reading "Alpha Basin" is slow
    When I tick "Alpha Basin"
    And I press the open button
    And I sign out and sign in as "otherlead" in the second tab
    Then this tab shows "Choose collections" for "otherlead"
    And once the slow read has had time to finish, this tab still shows "Choose collections" for "otherlead"
    And nothing was remembered for "otherlead"

  Scenario: Going back and reopening the same collections keeps everything as it was
    Given I have opened "Alpha Basin"
    When I filter species to "Bobcat"
    And I show the Photos table
    And I show only untagged photos
    And I go back to choose collections
    And I press the open button
    Then the species filter reads "Species: Bobcat"
    And the photo count reads "4 of 11 photos"
    And the Photos table has 0 rows
    And there is no note

  Scenario: Opening other collections keeps the filters that still apply, with Undo
    Given I have opened "Alpha Basin"
    When I filter species to "Deer (Mule)"
    And I filter locations to "AB02"
    And I go back to choose collections
    And I click the row of "Alpha Basin"
    And I tick "Bravo Flats"
    And I press the open button
    Then I see the note "Some filters no longer apply" with Undo
    And the species filter reads "Species: Deer (Mule)"
    And the locations filter reads "Locations"
    When I press Undo
    Then the locations filter reads "Locations: none"

  @preview-2
  Scenario: A collection picked in By collection is cleared right there, and the list stays put
    Given I am signed in
    And I open "Alpha Basin" and "Bravo Flats" together
    And I note where By collection is
    Then there is no "× Clear" by the collections
    When I pick "Bravo Flats" in By collection
    Then "Bravo Flats" is highlighted in By collection
    And By collection lists "Alpha Basin" then "Bravo Flats"
    And "× Clear" shows at the right end of the "By collection" line
    And By collection has not moved
    And the photo count reads "3 of 14 photos"
    When I press "× Clear" by the collections
    Then no row is highlighted in By collection
    And there is no "× Clear" by the collections
    And the photo count reads "14 photos"

  Scenario Outline: By collection's × Clear clears Collections as the filter's × does, and Back goes with it
    Given I am signed in
    And I open "Alpha Basin" and "Bravo Flats" together
    When I pick "Bravo Flats" in By collection
    And I press "Show photos" on the Locations row "BF01"
    Then the table's controls offer "Back to Locations" before the view switch
    When <clear>
    Then no row is highlighted in By collection
    And the locations filter reads "Locations: BF01"
    And there is no "Back to" button

    Examples:
      | clear                                     |
      | I press "× Clear" by the collections      |
      | I clear the Collections filter with its × |

  @preview-3
  Scenario: Collections open when the computer's clock is off, and Data checks says so
    Given I am signed in
    And the server's clock is 20 minutes ahead of this computer
    When I tick "Alpha Basin"
    And I tick "Bravo Flats"
    And I tick "Charlie Pond"
    And I press the open button
    Then the header names "Alpha Basin + 2 more"
    And the photo count reads "17 photos"
    When I open Data checks
    Then I see "Your computer's clock is about 20 minutes off. The explorer adjusted for it."

  @preview-3
  Scenario: A clock the explorer can't adjust for says what to do, and Retry failed opens once it is right
    Given I am signed in
    And the server's clock is 20 minutes ahead of this computer
    And the server doesn't say what time it is
    When I open "Alpha Basin" and "Bravo Flats" together
    Then I see "Alpha Basin and Bravo Flats: The server refused the request because your computer's clock is off. Check your date and time settings, then retry."
    And the opening panel offers "Retry failed"
    And the opening panel does not offer "Continue with"
    When the server's clock is right again
    And I press "Retry failed"
    Then the header names "Alpha Basin + 1 more"
    And the photo count reads "14 photos"

  @preview-3
  Scenario: Continue with the collections that opened; the others stay unticked for later
    Given I am signed in
    And the uploads of "Bravo Flats" can't be listed
    When I open "Alpha Basin" and "Bravo Flats" together
    Then I see "Bravo Flats: couldn't open"
    And I see "Bravo Flats: Access denied reading the uploads of \"Bravo Flats\""
    And the opening panel offers "Retry failed"
    When I press "Continue with Alpha Basin"
    Then the header names "Alpha Basin"
    And the photo count reads "11 photos"
    When I go back to choose collections
    Then "Alpha Basin" is ticked
    And "Bravo Flats" is not ticked

  @preview-3
  Scenario: Retry failed opens a collection once it can be read
    Given I am signed in
    And the uploads of "Bravo Flats" can't be listed
    When I open "Alpha Basin" and "Bravo Flats" together
    Then I see "Bravo Flats: couldn't open"
    When the uploads of "Bravo Flats" can be listed again
    And I press "Retry failed"
    Then the header names "Alpha Basin + 1 more"
    And the photo count reads "14 photos"

  @preview-6
  Scenario: A location in two collections names them in its Collection cell, not in a flag
    Given I am signed in
    And I open "Alpha Basin" and "Bravo Flats" together
    Then the header names "Alpha Basin + 1 more"
    And no flag reads "collections"
    And the Collection of "AB01" reads "2 collections", naming "Alpha Basin, Bravo Flats"
    When I tap the Collection of "AB01"
    Then a small list shows "Alpha Basin" and "Bravo Flats"
