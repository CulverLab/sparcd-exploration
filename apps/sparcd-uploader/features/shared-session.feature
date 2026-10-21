@cross-tool
Feature: Shared connection precedence across Uploader and Tagger

  @unmapped
  Scenario Outline: Correcting a refused endpoint survives same-tab app switching and reload
    Given the Uploader connection was corrected after a refused endpoint with Remember "<remember>"
    When Tagger is opened using the app switcher
    Then Tagger reads collections only from the corrected connection
    When the tools are switched and reloaded again
    Then Tagger reads collections only from the corrected connection

    Examples:
      | remember |
      | checked |
      | unchecked |

  @unmapped
  Scenario: Delayed sibling replies cannot replace the corrected session or resurrect logout
    Given the Uploader connection was corrected after a refused endpoint with Remember "unchecked"
    When Tagger is opened using the app switcher
    And a stale sibling sends its old session replies
    Then Tagger reads collections only from the corrected connection
    When Tagger logs out before another stale reply arrives
    Then the tools remain logged out after reload
