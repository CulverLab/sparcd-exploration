@H3
Feature: Recovering Need expert publication preserves later accepted actions
  Background:
    Given an upload with existing identifications is open in the tagging workspace

  Scenario Outline: Later work accepted during a save survives its failure and reload
    When a Need expert save is held after publishing media
    And a later "<edit>" action is accepted during that save
    And the earlier save fails and the browser reloads
    Then the complete "<edit>" result is stored with no pending drafts
    And retrying and reloading cannot duplicate its attribution events

    Examples:
      | edit      |
      | unchanged |
      | species   |
      | status    |
      | time      |

  Scenario Outline: Other changes retain a previously saved expert marker through retry
    When a saved expert image receives a "<edit>" action during an earlier save
    And the earlier save fails and the browser reloads
    Then the complete "<edit>" result is stored with no pending drafts
    And retrying and reloading cannot duplicate its attribution events

    Examples:
      | edit |
      | drop |
      | time |
