@cross-tool @unmapped
Feature: Prepare collection species for local tagging
  Species preparation is separate from Assign and does not promise offline app reopening.

  Background:
    Given a folder of media has been scanned
    And the New upload section is showing the Verify step

  Scenario: Missing preparation preserves Inspect but prevents local tagging
    Then local tagging requires online species preparation

  Scenario: A collection vocabulary is frozen into the real handoff
    Given Alpha has a collection-specific species list
    And species have been prepared for local tagging
    When "Tag species before upload" is chosen through the unified dev origin
    Then the real Tagger uses only the prepared Alpha species
    When the live shared account changes during local tagging
    Then the real Tagger uses only the prepared Alpha species

  Scenario Outline: Failed collection preparation never substitutes defaults
    Given Alpha species preparation will fail with "<failure>"
    When Alpha species preparation is attempted
    Then a preparation error preserves Inspect and blocks local tagging
    Examples:
      | failure   |
      | denied    |
      | malformed |
      | empty     |

  Scenario Outline: Assign reviews current vocabulary without discarding returned tags
    Given species have been prepared for local tagging
    When "Tag species before upload" is chosen through the unified dev origin
    And Coyote is applied in the real Tagger
    And the real Tagger identity is set to Anita
    And the real Tagger hands the batch back
    And the assigned species list is "<change>"
    Then Assign requires species review for "<change>"
    Examples:
      | change  |
      | renamed |
      | removed |

  Scenario Outline: An invalid handoff snapshot explains recovery without losing tags
    Given species have been prepared for local tagging
    When "Tag species before upload" is chosen through the unified dev origin
    And Coyote is applied in the real Tagger
    And the handoff preparation becomes "<problem>"
    Then the Tagger explains preparation recovery and preserves the batch
    Examples:
      | problem     |
      | missing     |
      | unsupported |
