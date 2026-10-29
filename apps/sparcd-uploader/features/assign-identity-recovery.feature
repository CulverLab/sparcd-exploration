Feature: Describe identity editing survives asynchronous account updates
  Scenario: A blank focused Assign identity survives lookup and shared preference updates
    Given the account-name endpoint rejects the login with AccessDenied
    And a scanned batch has passed the Verify step
    And the New upload section is showing the Describe step
    When the account-name lookup completes while the Assign identity is blank and focused
    Then the Assign identity remains blank until blur after a shared preference update
