# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/components/TimeShiftModal.tsx, src/components/BulkTimeShiftModal.tsx, src/components/PerImageTime.tsx, src/lib/timeshift.ts, src/lib/drafts.ts, src/lib/sync.ts, src/lib/syncRunner.ts).

@unmapped
Feature: Correct capture times on an upload whose camera clock was wrong

  """
  As-built flow: camera clocks drift — wrong timezone, daylight saving, a dead
  clock battery. The tagger can shift the capture time of a whole upload or a
  selection of frames. Focus does not provide an absolute per-image timestamp
  editor; its supported correction actions are the whole-upload and selection
  shifts. Corrections are held locally until a sync writes them; the original
  capture data is never rewritten locally.
  """

  Background:
    Given an upload is open in the tagging workspace

  @unmapped
  Scenario: A whole upload's capture times can be shifted by a signed offset
    When the time-shift dialog is opened
    Then a signed offset in years, months, days, hours, minutes and seconds can be set
    And a sample capture time is shown before and after the shift as the offset changes
    And applying it shifts every frame in the upload

  @unmapped
  Scenario: An active whole-upload shift is always visible
    Given a whole-upload shift is in effect
    Then the workspace toolbar shows the shift and its size

  @unmapped
  Scenario: A whole-upload shift can be removed
    Given a whole-upload shift is in effect
    When the shift is cleared
    Then the images show their original capture times again

  @unmapped
  Scenario: The whole-upload time shift is unavailable with nothing to shift
    Given an upload with no capture times is open in the tagging workspace
    Then the whole-upload time shift is disabled with an explanation

  @unmapped
  Scenario: An active whole-upload shift remains clearable with nothing to shift
    Given a persisted whole-upload shift exists for an upload with no capture times
    When the shift is cleared
    Then the standing shift is cleared afterwards

  @unmapped
  Scenario: Time shift selection requires an explicit selection
    Given a single image is focused with no selection
    Then time shift selection is disabled with an explanation

  @unmapped
  Scenario Outline: A selection containing exactly one frame can be shifted
    Given exactly one image is selected in the "<view>" Overview
    When that one-frame selection is shifted
    Then exactly that selected image receives a time override
    When that one-image selection is toggled off
    Then time shift selection is disabled with an explanation

    Examples:
      | view   |
      | grid   |
      | list   |
      | narrow |

  @unmapped
  Scenario: Selection time shift excludes images hidden by a filter
    Given several images are selected
    When the selection is filtered down to IMG001.JPG
    Then time shift selection is enabled
    When that one-frame selection is shifted
    Then exactly that selected image receives a time override

  @unmapped
  Scenario: Time shift selection works from the Focus view
    Given several images are selected
    When the selected images are shown in Focus
    Then time shift selection is enabled
    And the selection time-shift dialog opens
    And the selection time-shift dialog confines focus and closes with Escape

  @unmapped
  Scenario: Only the selected frames can be shifted when one camera was wrong
    Given several images are selected
    When the selection's time shift is applied
    Then only the selected frames move by the offset
    And each moves relative to the time it was already showing
    And the preview is anchored on the earliest selected frame

  @unmapped
  Scenario: Frames with no capture time are left out of a shift
    Given the selection includes frames with no recorded capture time
    When a selection shift is applied
    Then those frames are skipped
    And the dialog states that they are

  @unmapped
  Scenario: A selection with no capture times cannot be shifted
    Given only timestamp-less images are selected
    Then time shift selection is disabled because no selected frame has a capture time

  @unmapped
  Scenario: A synced whole-upload shift is not applied twice
    Given a whole-upload shift was written to the stored files by a sync
    Then the standing shift is cleared afterwards
    And the images show their now-corrected stored times without a further shift

  @unmapped
  Scenario: A whole-upload shift does not regroup bursts
    Given burst grouping is switched on
    When a whole-upload shift is applied
    Then the same images remain grouped together
    And only the times shown on the burst bands change
