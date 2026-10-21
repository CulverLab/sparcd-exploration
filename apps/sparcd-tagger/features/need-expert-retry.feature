@H3
Feature: Retrying Need expert publication preserves newer local edits
  Background:
    Given an upload with existing identifications is open in the tagging workspace
    And an image is focused

  Scenario Outline: A reloaded journal acknowledges only the state it submitted
    When a Need expert sync fails after publishing media
    And the interrupted image receives a "<edit>" edit
    And the interrupted sync is resumed after a browser reload
    Then the journaled status is saved and the "<edit>" draft is acknowledged correctly
    And the retry result survives another reload
    And the retained edit can be saved separately

    Examples:
      | edit      |
      | unchanged |
      | species   |
      | status    |
      | time      |

  Scenario Outline: Unrelated edits preserve a previously saved expert marker
    When a saved expert image receives a "<seed>" draft
    And a Need expert sync fails after publishing media
    And the interrupted image receives a "species" edit
    And the interrupted sync is resumed after a browser reload
    Then the saved expert marker survives retry and the subsequent sync

    Examples:
      | seed |
      | drop |
      | time |
