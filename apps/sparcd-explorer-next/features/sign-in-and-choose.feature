Feature: Sign in and choose collections

  Signing in and picking collections are two numbered steps. Nothing is
  picked for you, and the button always says what it will do.

  Scenario: The sign-in step asks for a username and a password
    When I open the explorer
    Then I see step 1 "Sign in" of the three steps
    And the sign-in form asks for "Username" and "Password"
    And the server field reads "Server address" with the example "server.example.org"
    And I see "Use the account your project lead set up for you."
    And I see "Remember me on this device"
    And the form's button reads "Sign in"
    And the HTTPS setting is only under "Advanced"

  Scenario: A wrong username or password is explained under the form
    Given the store does not know the username "stranger"
    When I sign in as "stranger"
    Then I see "That username or password didn't work."
    And I am still on the sign-in step

  @US-005
  Scenario: Nothing is picked at first and the button says what will open
    Given I am signed in
    Then I see step 2 "Choose collections" of the three steps
    And I see "Signed in as fieldlead"
    And the open button reads "Pick a collection" and is disabled
    When I tick "Alpha Basin"
    Then the open button reads "Open Alpha Basin"
    When I tick "Bravo Flats"
    Then the open button reads "Open 2 collections together"
    When I click the row of "Bravo Flats"
    Then the open button reads "Open Alpha Basin"

  Scenario: "Continue with" offers the last combination only while nothing is ticked
    Given I have opened "Alpha Basin"
    When I go back to choose collections
    Then "Alpha Basin" is ticked
    And there is no "Continue with" button
    When I clear the picked collections
    Then I see the button "Continue with Alpha Basin"
    When I tick "Bravo Flats"
    Then there is no "Continue with" button

  Scenario: Signing out returns to the sign-in step
    Given I am signed in
    When I sign out
    Then I see step 1 "Sign in" of the three steps

  @preview-1
  Scenario: Select all and Clear all pick every collection at once
    Given I am signed in
    When I press "Select all" above the collections
    Then every collection is ticked
    And the open button reads "Open 3 collections together"
    When I press "Clear all" above the collections
    Then no collection is ticked
    And the open button reads "Pick a collection" and is disabled

  @preview-1
  Scenario: With a search, Select all and Clear all act on the matches only
    Given there are 9 more collections called "Delta Ridge"
    And I am signed in
    And I tick "Alpha Basin"
    When I search the collections for "delta"
    And I press "Select all" above the collections
    Then the open button reads "Open 10 collections together"
    When I search the collections for "ridge 1"
    And I press "Clear all" above the collections
    Then the open button reads "Open 9 collections together"
    When I clear the search
    Then "Alpha Basin" is ticked
    And "Bravo Flats" is not ticked
    And "Delta Ridge 1" is not ticked
    And "Delta Ridge 2" is ticked
