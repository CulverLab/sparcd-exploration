@preparation-cleanup
Feature: Remove missing originals from the saved Uploader and Tagger batch
  Removing a missing or changed original removes its durable preparation and
  Tagger handoff together, so recovery and Edit tags cannot bring it back.

  Background:
    Given a folder of media has been scanned
    And the New upload section is showing the Verify step
    And species have been prepared for local tagging

  Scenario Outline: A missing original can be removed by <action> and stays removed after reload and Edit tags
    Given a tagged batch returns with IMG_0001.JPG unavailable
    When the missing original is removed by "<action>"
    Then the file and its saved identification are removed from both journals
    And the file stays absent after recovery reload and Edit tags return
    Examples:
      | action   |
      | mouse    |
      | keyboard |

  Scenario: A changed original can be removed from both saved records
    Given a tagged batch returns with IMG_0001.JPG changed
    When the missing original is removed by "mouse"
    Then the file and its saved identification are removed from both journals
    And the file stays absent after recovery reload and Edit tags return

  Scenario: Focus moves to the recovery heading when no listed file remains
    Given a tagged batch returns with IMG_0001.JPG unavailable
    When the file list is filtered to only the unavailable original
    And that last displayed original is removed

  Scenario: Focus moves to the previous file when the last filtered row is removed
    Given a tagged batch returns with IMG_0001.JPG and IMG_0002.JPG unavailable
    When the last filtered original IMG_0002.JPG is removed

  Scenario: The named Remove control works with keyboard activation
    Given a tagged batch returns with IMG_0001.JPG unavailable
    When the remove control is activated with the keyboard
    Then the file and its saved identification are removed from both journals

  Scenario: A failed Flip update stays hidden and blocks navigation until retry succeeds
    Given a tagged batch returns with IMG_0001.JPG unavailable
    When the Flip update fails once during removal
    Then the pending removal stays hidden and blocks navigation until retry succeeds
    And the file and its saved identification are removed from both journals
    And the file stays absent after recovery reload and Edit tags return

  Scenario: A pending removal replays after reload before the batch is offered again
    Given a tagged batch returns with IMG_0001.JPG unavailable
    When the Flip update fails once during removal
    Then the pending removal remains hidden and navigation is blocked
    When the browser reloads while the removal is pending
    Then the file and its saved identification are removed from both journals
    And the file stays absent after recovery reload and Edit tags return

  @cross-tool
  Scenario: A returned batch remains editable without a storage login
    Given a batch was tagged in the Tagger and handed back
    When the storage login is disconnected and deferred
    Then Edit tags remains available with the batch's prepared species

  Scenario: Recovery reopens saved tags with the verified owner scope
    Given a batch was tagged in the Tagger and handed back
    When the saved preparation recovery list is opened
    Then the Reopen saved tags link carries the batch owner scope

  @touch
  Scenario: A missing original can be removed by touch at a narrow viewport
    Given a tagged batch returns with IMG_0001.JPG unavailable
    When the missing original is removed by touch at a narrow viewport
    Then the file and its saved identification are removed from both journals
