Feature: One sign-in across tabs

  Scenario: Signing in once carries over to a new tab
    Given I am signed in
    When I open the explorer in a new tab
    Then the new tab shows "Choose collections" without asking for a password

  Scenario: Signing out in one tab signs out the other
    Given I am signed in
    And the explorer is open in a second tab
    When I sign out
    Then the second tab shows the sign-in step

  Scenario: An older sign-in sent from another tab never replaces a newer one
    Given I am signed in
    And another tab holds on to this sign-in
    When I sign out and sign in as "otherlead"
    And the other tab sends its old sign-in
    And I reload the page
    Then this tab shows "Choose collections" for "otherlead"
    When I sign out
    And the other tab sends its old sign-in
    And I reload the page
    Then I am still on the sign-in step
