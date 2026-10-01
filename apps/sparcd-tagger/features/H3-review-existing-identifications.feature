# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/lib/workspace.ts, src/lib/effective.ts, src/components/AppliedSpecies.tsx, src/components/Overview.tsx, src/sections/Tag.tsx, src/lib/sync.ts, src/lib/drafts.ts).

@H3
Feature: Review, correct and remove identifications that already exist

  """
  As a species identifier, I want to review and confirm identifications that
  already exist on an upload, so that prior work is validated rather than
  redone.
  """

  As-built: opening an upload reads the identifications already stored for it
  — whether they came from the desktop app, sparcd-web or an earlier tagger
  sync — and shows them on each image. They can be corrected, re-counted or
  removed; the changes reach the stored files only through a sync, which is
  stamped with the connected account that performs the sync.

  Background:
    Given an upload with existing identifications is open in the tagging workspace

  @H3
  Scenario: Existing identifications are shown on the images that carry them
    Then each image's tile shows the species already recorded for it
    And an image with several species shows the first with a count of the rest
    And an image with no species is labelled "untagged" in the list view
    # Corrected against the app: only the LIST view writes "untagged". A grid
    # tile with no species shows its file name instead. See CORRECTIONS.md.

  @H3 @H3-1
  Scenario: The focused image's identifications and counts are listed in full
    Given an image with existing identifications is focused
    Then each recorded species is shown with its count
    And a species recorded as a free-text request is marked as requested
    And several species collapse to a summary that can be expanded

  @H3
  Scenario: A recorded count can be corrected
    Given the focused image records a species with a count
    When the count is changed
    Then the new count is held against that species for that image
    And a count below one is not accepted

  @H3
  Scenario: A single wrong identification can be removed without losing the others
    Given the focused image carries several species
    When one of them is removed
    Then only that species is dropped
    And the remaining species and their counts are preserved

  @H3 @H3-4
  Scenario: Removing an existing species records the removal
    Given the focused image carries several species
    When one of them is removed
    And a live sync is run
    Then the removed species is absent from the stored image and marked as removed

  @H3
  Scenario: Every identification on an image can be cleared at once
    Given the focused image carries at least one species
    When Clear Species is used
    Then the image is left with no species
    And it reads as untagged again
    And the Clear Species control is unavailable on an image that has none

  @H3
  Scenario: Clearing identifications can be applied across a selection
    Given several images are selected
    When identifications are cleared
    Then every selected image is left with no species

  @H3
  Scenario: An image can be flagged as questionable for a second opinion
    Given an image is focused
    When it is marked questionable
    Then the image's tile carries a questionable marker
    And the marker can be toggled off again
    And a selection of images can be marked in one action
    # As-built: the questionable flag stays in this browser. It is not part of
    # the canonical files a sync writes, so it does not travel to other users
    # and its drafts stay listed as unsaved after a sync. Flag for review.

  @H3 @H3-2
  Scenario: A confirmation records who reviewed it and when, even though nothing changes
    Given an existing identification is re-applied unchanged
    When a sync is previewed
    Then the preview reports one confirmed image and no other change
    When that sync is run live
    Then the confirmed image's stored identification is stamped with the reviewer and the time of the review
    # #368 (Q12): a review records the reviewer and the date even when
    # nothing changes. Re-applying an already-present species — the existing
    # apply gesture — is how a reviewer confirms it.

  @H3
  Scenario: A correction is attributed to the person who synced it
    Given identifications were corrected locally
    When a live sync is run
    Then the upload's metadata gains an edit comment carrying the connected account and the time of the edit
    And the pre-change snapshot of the upload is filed under that same identity

  @H3 @H3-5
  Scenario: Both a confirmation and a correction record their own reviewer and timestamp
    Given an existing identification is re-applied unchanged
    And identifications were corrected locally
    When a live sync is run
    Then the confirmed image's stored identification is stamped with the reviewer and the time of the review
    And the corrected image's stored identification is stamped with the reviewer and the time of the review

  @H3
  Scenario: An image edited locally is distinguishable from one that is not
    Given an image's identifications were changed in this browser
    Then its tile carries an unsaved-edit marker
    And the marker is cleared for that image once its change has been synced

  @H3
  Scenario: Identifications are shown even when the producer never wrote observation_type
    Given an upload from a producer that never populates observation_type is open in the tagging workspace
    Then each image's tile shows the species already recorded for it
    And images without observations remain untagged
    # A real-world video-ingestion upload leaves the observation_type column
    # blank on every row, including ones that plainly name a species (#306).
    # Rows naming a species must display, while images with no observation row
    # still remain untagged.

  @H3
  Scenario: Uploader-written blank rows are shown as untagged, not as identified images
    Given an upload with only uploader-written blank rows is open in the tagging workspace
    Then every image tile is shown as untagged
    And the list view labels every image "untagged"

  @H3
  Scenario: A blank-row upload reports nothing to sync before any identifications are made
    Given an upload with only uploader-written blank rows is open in the tagging workspace
    When the Sync dialog is opened for a blank-row upload
    Then the sync reports there is nothing to sync
