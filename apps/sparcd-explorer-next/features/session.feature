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
