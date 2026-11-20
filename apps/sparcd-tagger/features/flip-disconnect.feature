Feature: Preserve owner-scoped local handoffs when Tagger disconnects
  Background:
    Given the tagger is connected

  Scenario: Canceling the Disconnect confirmation keeps connection and exact rows
    Given owner-scoped local handoffs exist for the connected and other logins
    When Disconnect is requested from Settings
    Then the prompt counts only this login handoffs and defaults to keeping them
    When the Disconnect prompt is cancelled with its Cancel button
    Then the connection and all handoffs remain and focus returns to the opener

  Scenario: Keeping local work lets the matching login reopen the handoff
    Given owner-scoped local handoffs exist for the connected and other logins
    When Disconnect is requested from Settings
    And Disconnect is confirmed while keeping local work
    Then the login disconnects and its local handoff remains recoverable

  Scenario: The header Logout action uses the same handoff confirmation
    Given owner-scoped local handoffs exist for the connected and other logins
    When the header Logout action is used
    Then the prompt counts only this login handoffs and defaults to keeping them
    When the Disconnect prompt is cancelled with Escape
    Then the connection and all handoffs remain and focus returns to the opener

  Scenario: Discard deletes only unchanged records from the confirmation snapshot
    Given the current login has two local handoffs to review
    When one handoff changes and another is added after the prompt opens
    Then only the unchanged reviewed handoff is deleted and the others require another decision
