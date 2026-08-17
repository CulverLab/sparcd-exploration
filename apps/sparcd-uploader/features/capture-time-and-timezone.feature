# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-uploader (src/sections/Assign.tsx, src/components/CaptureTimeEditor.tsx, src/lib/exifTime.ts, src/lib/coords.ts, src/lib/bundle.ts, test/exifTime.test.ts, test/bundle.test.ts).

@unmapped
Feature: Establish the true capture time of every file

  """
  As-built flow: a camera writes a wall-clock time with no timezone, so the same
  written time means a different instant depending on where the camera stands.
  The uploader records which timezone to read those times in, defaults it from
  the chosen camera location, and requires a time for every file before the
  batch can be published.
  """

  Background:
    Given a scanned batch has reached the Assign step

  @unmapped
  Scenario: The upload timezone starts as this machine's timezone
    Given no deployment has been chosen yet
    Then the upload timezone is the timezone of the machine doing the upload

  @unmapped
  Scenario: Choosing a camera location sets the timezone to that location's timezone
    When a deployment location is chosen
    Then the upload timezone changes to the timezone the location's coordinates fall in
    # Derived from the location's latitude and longitude; approximate near a
    # timezone border.

  @unmapped
  Scenario: A timezone chosen by hand is not overwritten
    Given a deployment location has been chosen
    When the user then picks a different timezone
    Then that choice stands for as long as the same location stays selected

  @unmapped
  Scenario: Any timezone can be selected, including one the machine does not list
    Then the timezone list offers every timezone the browser knows
    And the currently chosen timezone is always offered even if it is not in that list

  @unmapped
  Scenario: Camera times are stored as the instant they represent in the chosen timezone
    Given a file whose camera wrote a wall-clock time
    When the batch is published
    Then the stored capture time is that wall-clock read in the upload timezone
    And daylight-saving time in force on that date is accounted for
    And the stored time does not depend on the timezone of the machine uploading

  @unmapped
  Scenario: Files with no camera capture time are collected for manual entry
    Given some examined files carry no camera capture time
    Then the Assign step lists exactly those files with a time field each
    And it states how many of them still have no time

  @unmapped
  Scenario: One time can be applied to every file still missing one
    Given several files are still missing a capture time
    When a time is entered once and applied in bulk
    Then every file that had no time receives it
    And files that already had a time keep the one they had

  @unmapped
  Scenario: A camera-supplied time is never replaced by a manually entered one
    Given a file whose camera wrote a capture time
    Then it is not offered for manual entry
    And the camera's time is what gets stored

  @unmapped
  Scenario: A manually entered time can be cleared
    When a manually entered time is cleared
    Then that file counts again as missing a capture time
    And the batch cannot be published until it is given one

  @unmapped
  Scenario: An impossible date is refused
    When a date that does not exist is entered, such as 31 February
    Then it is not accepted as a capture time
    # Refusing it matters because a nonexistent date would otherwise be silently
    # shifted to a real one and published as the authoritative capture time.

  @unmapped
  Scenario: A published batch never carries an empty capture time
    Given every examined file has either a camera time or a manual one
    When the batch is published
    Then every media row carries a capture time
