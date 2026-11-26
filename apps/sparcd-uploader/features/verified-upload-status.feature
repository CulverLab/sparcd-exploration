Feature: Explain completed files without suggesting images were omitted

  Background:
    Given the uploader is connected

  @unmapped
  Scenario: Fresh upload completion counts only newly uploaded files
    When a fresh upload completes for the status summary
    Then completion explains 4 newly uploaded and 0 already verified files
    And automatic recovery is not reported

  @unmapped
  Scenario Outline: Manual recovery explains files already on the server
    Given <verified> files were already uploaded before interruption
    When status recovery is requested from "<page>"
    Then completion explains 1 newly uploaded and <verified> already verified files
    And automatic recovery is not reported
    Examples:
      | verified | page    |
      | 1        | Upload  |
      | 3        | Upload  |
      | 1        | History |
      | 3        | History |

  @unmapped
  Scenario: A missing server object is uploaded instead of counted as verified
    Given 3 files were already uploaded before interruption
    And a previously stored object is now missing
    When status recovery is requested from "Upload"
    Then completion explains 2 newly uploaded and 2 already verified files

  @unmapped
  Scenario Outline: A server mismatch cannot be counted as verified completion
    Given 3 files were already uploaded before interruption
    And a previously stored object has a different "<property>"
    When status recovery is requested from "Upload"
    Then the mismatched server object is not reported as done
    Examples:
      | property    |
      | size        |
      | fingerprint |

  @unmapped
  Scenario: Automatic recovery explains why no images need sending again
    Given the connection interrupted publication after all files were stored
    When the connection returns for automatic status recovery
    Then completion explains 0 newly uploaded and 4 already verified files
    And the upload explains that it recovered automatically
