@unmapped
Feature: Expert requests use consistent Need expert terminology
  Background:
    Given an upload is open in the tagging workspace

  Scenario Outline: The Focus details action keeps its label when expert status changes and reloads
    Given the Focus expert action is opened at width <width>
    Then the Focus Need expert action is "clear"
    When the Focus Need expert action is toggled
    Then the Focus Need expert action is "marked"
    When the expert request is saved and the same image is reopened
    Then the Focus Need expert action is "marked"
    When the Focus Need expert action is toggled
    Then the Focus Need expert action is "clear"
    When the expert request is saved and the same image is reopened
    Then the Focus Need expert action is "clear"
    Examples:
      | width |
      | 1440  |
      | 390   |
