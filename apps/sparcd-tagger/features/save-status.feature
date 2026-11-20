@unmapped
Feature: Save status explains what is saved and what needs attention
  Scenario: Untouched uploads are Saved only after checks complete
    Given an untouched upload whose save check is held
    Then its save badge is Checking until the check completes
    And its Saved popup says there is nothing to do

  Scenario: Recheck returns to Checking and then to the resulting status
    Given an upload whose save status cannot be checked
    Then Recheck checks again and returns to Recheck on failure or Saved on success

  Scenario Outline: A blocked save explains the next step without changing pending work
    Given a real save stopped by "<reason>"
    Then its Browse badge is "<badge>" with popup "<popup>"
    And its existing Open control shows "<control>" without resolving anything
    Examples:
      | reason   | badge    | popup                                                                                       | control                             |
      | conflict | Conflict | Changes could not be saved because stored data changed. Use Open to review unsaved changes. | Compare local changes with storage  |
      | access   | Repair   | Saving was previously denied. Use Open to resolve the access problem.                       | Repair credentials for this account |

  Scenario: Retry save performs a safe retry of the affected active upload
    Given a real save stopped by "failure"
    Then Retry save retries that upload and reaches Saved without opening another upload

  Scenario: Transient saves display Retrying and recover automatically
    Given a real save stopped by "transport"
    Then its Browse badge is "Retrying" with popup "Saving is retrying now"
    And it becomes Saved when storage accepts retries again

  Scenario: Earlier pending work is recovered through the existing Open control
    Given legacy unsaved work in an unopened upload
    Then its Browse badge is "Recover" with popup "Earlier changes remain unsaved. Use Open to recover them."
    And its existing Open control shows "Recover pending work for this account and upload" without resolving anything

  Scenario: Retry save on an inactive upload targets that upload
    Given retained retryable work in a different unopened upload
    Then Retry save opens and saves that upload without changing the previous upload

  Scenario: A local status read failure never claims Saved
    Given local save-status reads fail
    Then the local failure shows Recheck and recovers after a new check

  Scenario Outline: Compact statuses and explanations remain usable
    Given an upload list with a Conflict badge at width <width>
    Then the status and Open fit and the popup is available without opening the upload
    Examples:
      | width |
      | 375   |
      | 853   |
      | 1440  |
      | 1920  |

  Scenario: A blocked read cannot hide known earlier unsaved work
    Given legacy unsaved work in an unopened upload
    Then a failed upload read still leaves its Recover badge and pending work intact

  Scenario Outline: Recheck retries failed active-upload reads
    Given opening an upload failed while reading "<file>"
    Then Recheck retries that read and stays unknown while it is still denied
    And Recheck reaches Saved after access is restored without writing changes
    Examples:
      | file             |
      | media.csv        |
      | observations.csv |

  Scenario: Recheck does not retry a different upload's failed workspace read
    Given another upload's status cannot be checked
    And opening an upload failed while reading "media.csv"
    Then rechecking the other upload leaves the failed active upload untouched

  Scenario: Recheck recovers a failed Undo read without performing Undo
    Given Undo failed while checking an already saved upload
    Then Recheck retries that read and stays unknown while it is still denied
    And Recheck reaches Saved after access is restored without writing changes
    And the saved action is only undone when Undo is explicitly selected

  Scenario Outline: Failed initialization remains unknown and Recheck retries initialization
    Given upload setup fails with "<work>" work
    Then failed setup offers Recheck and repeated setup failures remain unknown
    And restoring setup lets Recheck show "<status>" without consuming pending work
    Examples:
      | work     | status  |
      | no       | Saved   |
      | retained | Recover |

  Scenario: Recheck of failed setup does not publish retained automatic actions
    Given upload setup fails with "queued" work
    Then failed setup offers Recheck and repeated setup failures remain unknown
    And restoring setup lets Recheck show "Retry save" without consuming pending work
    And queued changes wait for an explicit Retry save

  Scenario: An offline retry does not claim that paused work is retrying
    Given upload setup fails with "queued" work
    Then failed setup offers Recheck and repeated setup failures remain unknown
    And restoring setup lets Recheck show "Retry save" without consuming pending work
    And an offline retry remains Retry save until a connected retry is selected
