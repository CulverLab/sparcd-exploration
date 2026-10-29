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
  removed; the completed changes save automatically with their acting-user attribution.

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

  @H3 @H3-3
  Scenario: Replacing an existing species records the correction
    Given the focused image carries an existing species to correct
    When the existing species is replaced with another species
    And automatic saving finishes
    Then the stored replacement records the previous species as corrected

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
    And automatic saving finishes
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
  Scenario Outline: Clear Species follows the selection in either view even when focus is outside it
    Given a mixed selection with focus "<focus>" the selection in "<view>"
    Then Clear Species explains its two-image selection on hover and focus
    When selection clearing is activated with "<key>" in "<view>"
    Then only the tagged selected image has a dirty draft
    And unselected identifications remain unchanged

    Examples:
      | view  | focus   | key   |
      | grid  | inside  | Enter |
      | list  | outside | Space |
      | focus | inside  | Enter |
      | focus | outside | Space |

  @H3
  Scenario: Clearing identifications in Focus clears every selected tagged image
    Given several images are selected
    When Focus is entered
    And identifications are cleared
    Then every selected image is left with no species

  @H3
  Scenario Outline: Clearing without a selection affects only the focused image
    Given a tagged image is focused without a selection in "<view>"
    When identifications are cleared
    Then only the focused image has a dirty draft
    And unselected identifications remain unchanged

    Examples:
      | view  |
      | grid  |
      | focus |

  @H3
  Scenario Outline: An untagged focused image does not hide a tagged selection's Clear Species action
    Given a tagged and an untagged image are selected with the untagged one focused in "<view>" Overview
    Then Clear Species explains its two-image selection on hover and focus
    When Clear Species is activated with "<key>"
    Then only the selected tagged image is edited in "<view>" Overview

    Examples:
      | view | key   |
      | grid | Enter |
      | list | Space |

  @H3
  Scenario: Clear Species is unavailable when only untagged targets are selected
    Given only an untagged image is selected while a tagged image is focused
    Then Clear Species is absent and no image has a new draft

  @H3
  Scenario Outline: A filtered selection cannot clear hidden images
    Given several images are selected
    When the selection is filtered to IMG003.JPG and cleared in "<view>"
    Then the hidden selected images keep their original species

    Examples:
      | view  |
      | grid  |
      | focus |

  @H3
  Scenario Outline: A cleared selection survives automatic saving and reload without changing other images
    Given several images are selected
    And the unselected species rows are recorded
    And clearing is prepared in "<view>"
    When identifications are cleared
    And automatic saving finishes
    Then the cleared selection is stored and restored without changing other images

    Examples:
      | view  |
      | grid  |
      | focus |

  @H3
  Scenario: An image can be flagged as questionable for a second opinion
    Given an image is focused
    When it is marked questionable
    Then the image's tile carries a questionable marker
    And the marker can be toggled off again
    And a selection of images can be marked in one action
    # Need expert is stored in media.csv and shared after automatic saving.

  @H3
  Scenario: Need expert is a compact shared status in Overview and Focus
    Given an image is focused
    Then the compact Need expert control is accessible in Overview
    When Need expert is enabled from the compact control
    And the Need expert change finishes automatic saving
    And automatic saving finishes
    Then media.csv stores Need expert without rewriting observations
    And the Need expert marker returns after a reload
    And a new browser session sees the saved Need expert status
    And the compact Need expert control is accessible in Focus
    When Need expert is cleared from Focus
    And automatic saving finishes
    Then media.csv no longer stores Need expert
    And the cleared Need expert status remains off after reload

  @H3
  Scenario: Need expert remains keyboard reachable in narrow Overview and Focus
    Given an image is focused
    When the workspace is narrowed to a phone width
    Then Need expert can be toggled from the keyboard in Overview
    And Need expert fits and remains keyboard reachable in Focus

  @H3
  Scenario: A mixed selection shows its target and one action applies the focused state
    Given an image is focused
    When one image is marked Need expert and three images are selected
    Then the compact toggle describes the mixed selection and marks it in one activation

  @H3
  Scenario: A touch activation changes Need expert exactly once
    Then a touch user can mark and clear Need expert with one tap each

  @H3
  Scenario: Reversing an unsynced Need expert status resolves the local edit
    Given an image is focused
    When Need expert is enabled from the compact control
    And Need expert is toggled off before the save debounce
    Then the image has no pending Need expert edit

  @H3
  Scenario: A concurrent media edit blocks a pending Need expert status
    Given an image is focused
    When Need expert is enabled from the compact control
    And another writer changes media.csv
    Then automatic saving reports a media conflict and retains the expert edit

  @H3 @H3-2
  Scenario: A confirmation records who reviewed it and when, even though nothing changes
    Given an existing identification is re-applied unchanged
    When the automatic review save completes
    Then the automatic review retains the original species and count
    When the automatic review is fully saved
    Then the confirmed image's stored identification is stamped with the reviewer and the time of the review
    # #368 (Q12): a review records the reviewer and the date even when
    # nothing changes. Re-applying an already-present species — the existing
    # apply gesture — is how a reviewer confirms it.

  @H3
  Scenario: A correction is attributed to the person who synced it
    Given identifications were corrected locally
    When automatic saving finishes
    Then the upload's metadata gains an edit comment carrying the connected account and the time of the edit
    And the automatic action audit records that same identity without a per-edit snapshot

  @H3 @H3-5
  Scenario: Both a confirmation and a correction record their own reviewer and timestamp
    Given an existing identification is re-applied unchanged
    And identifications were corrected locally
    When automatic saving finishes
    Then the confirmed image's stored identification is stamped with the reviewer and the time of the review
    And the corrected image's stored identification is stamped with the reviewer and the time of the review

  @H3 @H3-6
  Scenario: A review keeps original attribution separate from the review event
    Given an existing identification has original attribution
    And an existing identification is re-applied unchanged
    When automatic saving finishes
    Then the original identifier and separate review remain visible in the stored image

  @H3 @H3-8
  Scenario: A single unreviewed species control omits attribution and review warnings in Overview and Focus
    Given an unreviewed single-species image is focused
    Then the species control has no original attribution or negative review text
    When the species control is shown in Focus
    Then the species control has no original attribution or negative review text

  @H3 @H3-8
  Scenario: Unreviewed multi-species controls omit attribution and review summaries in Overview and Focus
    Given a multi-species image with no review events is focused
    When species controls are collapsed
    And the viewport is set to 390 pixels wide
    Then expanded species controls have no original attribution or negative review text
    When species controls are collapsed
    Then the collapsed species summary has no review label or original attribution
    When the same species controls are shown in Focus
    Then Focus lists each applied species without original attribution or negative review text

  @H3 @H3-8
  Scenario: Reviewed multi-species controls retain positive review information in Overview and Focus
    Given a multi-species image with all identifications reviewed is focused
    Then expanded species controls show positive review information without original attribution
    When species controls are collapsed
    Then the collapsed species summary says Reviewed
    When the same species controls are shown in Focus
    Then Focus lists each applied species with positive review information and no original attribution

  @H3 @H3-8
  Scenario: Mixed multi-species controls use Partly reviewed in Overview and Focus
    Given an image with mixed reviewed and unreviewed identifications is focused
    Then expanded species controls show positive review information without negative labels
    When species controls are collapsed
    Then the collapsed species summary says Partly reviewed
    When the same species controls are shown in Focus
    Then Focus lists each applied species with positive review information and no negative labels

  @H3 @H3-7
  Scenario: A correction preserves the immutable original upload baseline
    Given the original upload data is captured before a review
    And identifications were corrected locally
    When automatic saving finishes
    Then the original uploaded data remains byte-for-byte intact
    And the live audit records the correction identity and time

  @H3 @H3-7
  Scenario: A removal preserves the immutable original upload baseline
    Given the original upload data is captured before a review
    And the focused image carries at least one species
    When Clear Species is used
    And automatic saving finishes
    Then the original uploaded data remains byte-for-byte intact
    And the live audit records the removal identity and time

  @H3 @H3-7
  Scenario: Repeated reviews do not duplicate the original upload baseline
    Given the original upload data is captured before a review
    And identifications were corrected locally
    When automatic saving finishes
    And another review is made locally
    And automatic saving finishes
    Then the original uploaded data remains byte-for-byte intact
    And the live audit records the correction identity and time

  @H3 @H3-8
  Scenario: Overview shows the mixed review state for an image
    Given an image with mixed reviewed and unreviewed identifications is focused
    And the image tile reports a mixed review status
    And the list row reports a mixed review status
    And an identification without a review event is labelled not reviewed

  @H3
  Scenario: An image edited locally is distinguishable from one that is not
    Given an image's identifications were changed in this browser
    Then its tile carries an unsaved-edit marker
    And the marker clears after the automatic save completes

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
    When an untouched blank-row upload is checked for pending work
    Then the blank-row upload is Saved without any write
