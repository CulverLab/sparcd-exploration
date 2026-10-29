@cross-tool @unmapped
Feature: Cache the Settings master list for optional Uploader tagging
  Catalog refresh is automatic and never changes an existing batch snapshot.

  Background:
    Given a folder of media has been scanned
    And the New upload section is showing the Verify step

  Scenario: The master vocabulary is frozen into the real handoff despite a collection-specific list
    Given Alpha has a collection-specific species list
    And species have been prepared for local tagging
    When "Tag species before upload" is chosen through the unified dev origin
    Then the optional tagging feature uses the saved master species
    When the live shared account changes during local tagging
    Then the optional tagging feature uses the saved master species

  Scenario Outline: Failed master refresh retains the last valid catalog
    Given master refresh will fail with "<failure>"
    When master refresh is attempted
    Then the last valid catalog preserves Inspect and optional tagging
    Examples:
      | failure   |
      | denied    |
      | malformed |
      | empty     |

  Scenario Outline: Describe checks current vocabulary without discarding returned tags
    Given species have been prepared for local tagging
    When "Tag species before upload" is chosen through the unified dev origin
    And Coyote is applied in the real Tagger
    And the real Tagger identity is set to Anita
    And the real Tagger hands the batch back
    And the assigned species list is "<change>"
    Then Describe handles the species check for "<change>"
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
