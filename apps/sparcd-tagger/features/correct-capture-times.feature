# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/components/TimeShiftModal.tsx, src/components/BulkTimeShiftModal.tsx, src/components/PerImageTime.tsx, src/lib/timeshift.ts, src/lib/drafts.ts, src/lib/sync.ts, src/lib/syncRunner.ts).

@unmapped
Feature: Correct capture times on an upload whose camera clock was wrong

  """
  As-built flow: camera clocks drift — wrong timezone, daylight saving, a dead
  clock battery. The tagger can shift the capture time of a whole upload, of a
  selection of frames, or of a single frame. The correction is held alongside
  the original until a sync writes it; the original is never rewritten locally.
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
    And each shifted image is marked as shifted where its time is displayed

  @unmapped
  Scenario: A whole-upload shift can be removed
    Given a whole-upload shift is in effect
    When the shift is cleared
    Then the images show their original capture times again

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
  Scenario: A single frame's time can be set outright
    Given an image is focused
    When a corrected timestamp is typed for it
    Then that image shows the corrected time and is marked as carrying an image override
    And its override can be cleared to fall back to the whole-upload shift

  @unmapped
  Scenario: An impossible timestamp is refused rather than stored
    When a typed timestamp is not a real date and time
    Then the entry is marked invalid and is not applied
    # Accepts "YYYY-MM-DD HH:mm" or "YYYY-MM-DDTHH:mm:ss"; rejects out-of-range
    # values and impossible calendar days such as 30 February.

  @unmapped
  Scenario: The original capture time is always still visible
    Given a frame's time has been corrected
    Then the corrected time is shown prominently
    And the original capture time is shown struck through beneath it

  @unmapped
  Scenario: Corrections change nothing stored until they are synced
    Given times have been corrected in the workspace
    Then the stored capture times are unchanged
    And the sync preview counts how many images would have a corrected time
    And only a live sync writes the corrected times into the upload's stored files

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
