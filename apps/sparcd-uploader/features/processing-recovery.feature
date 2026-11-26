Feature: Recover processing failures during an upload

  Background:
    Given the uploader is connected

  @unmapped
  Scenario Outline: Valid source files recover in the original upload
    Given file processing fails transiently after uploading starts
    Then the processing error keeps its source filename visible
    When processing recovery is requested from "<page>"
    Then every source file is published in the original upload without duplicating completed files
    Examples:
      | page                 |
      | Upload               |
      | History              |
      | History after reload |

  @unmapped
  Scenario: A file that remains unreadable blocks publication with an actionable error
    Given file processing keeps failing after uploading starts
    When processing recovery is requested from "Upload"
    Then the unreadable file is named and publication remains blocked

  @unmapped
  Scenario: Failed History recovery preserves the original upload and its source files
    Given file processing keeps failing after uploading starts
    When processing recovery is requested from "History"
    Then failed History recovery preserves the original upload lock
    When source processing becomes available again
    And processing recovery is requested from "History"
    Then every source file is published in the original upload without duplicating completed files

  @unmapped
  Scenario: Resume shows progress while processing is running
    Given file processing fails transiently after uploading starts
    When retry processing is held in progress
    Then recovery progress is visible and another retry is disabled
    When retry processing is released
    Then every source file is published in the original upload without duplicating completed files
