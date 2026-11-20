Feature: Choose a species list for Uploader pre-upload tagging

  Background:
    Given a folder of media has been scanned
    And the New upload section is showing the Verify step

  @A1
  Scenario: Online choices use discovered collections and wait to read collection species until Continue
    When the species list chooser is opened
    Then it offers the Master species list and discovered collections
    And Alpha collection species have not been read
    Given Alpha Collection has a species list containing Fox
    When Alpha Collection is chosen and continued
    Then the Tagger hand-off uses Alpha Collection species

  @A1
  Scenario Outline: Missing or empty collection species use the Master list
    Given Alpha Collection species are <state>
    When the species list chooser is opened
    And Alpha Collection is chosen and continued
    Then the Tagger hand-off for Alpha Collection uses the Master species list

    Examples:
      | state   |
      | missing |
      | empty   |

  @A1
  Scenario Outline: Unreadable or malformed collection species are reported without fallback
    Given Alpha Collection species are <state>
    When the species list chooser is opened
    And Alpha Collection is chosen and continued
    Then the collection species error is shown without using the Master list

    Examples:
      | state     |
      | denied    |
      | malformed |

  @A1
  Scenario: Cached species choices remain available offline without storage requests
    When the species list chooser is opened
    And Alpha Collection has a species list containing Fox
    And Alpha Collection is chosen and continued
    Then the Tagger hand-off uses Alpha Collection species
    When the Uploader is reopened with another batch and taken offline
    And the species list chooser is opened
    Then the offline message and locally saved Alpha Collection choice are shown
    When Alpha Collection is chosen and continued
    Then the offline Tagger hand-off uses the saved Alpha Collection species without requests

  @A1
  Scenario: Offline with no saved species list offers Cancel without starting tagging
    Given the Uploader has no locally saved species lists and is taken offline
    When the species list chooser is opened
    Then the offline empty state and Cancel action are shown
    When the chooser is canceled
    Then the batch remains in Inspect and no Tagger hand-off is created

  @A1
  Scenario: Tags outside the eventual upload collection remain and do not block publishing
    Given a batch was tagged using Alpha Collection species and handed back
    And Beta Collection has a species list containing only Fox
    When the batch is re-entered using the Master species list and returned
    Then Ghost, its count, and attribution are preserved
    When the tagged batch is published to Beta Collection
    Then the saved observations still contain Ghost
    And the upload destination is Beta Collection
    And upload did not read Beta Collection species to validate the tag
