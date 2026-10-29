@H1
Feature: Focus shows position in the navigable image list
  Background:
    Given an upload is open in the tagging workspace

  Scenario: Full-list progress follows images and video through both boundaries
    When Focus opens on the first image for position coverage
    Then Focus position is "Image 1 of 6 total" at 1 of 6
    And the Focus previous control is absent at the boundary
    When Focus moves to a middle media item
    Then Focus position is "Image 3 of 6 total" at 3 of 6
    When Focus moves to the last media item
    Then Focus position is "Image 6 of 6 total" at 6 of 6
    And the focused media is the final video
    And the Focus next control is absent at the boundary
    When Focus returns to the first media item
    Then Focus position is "Image 1 of 6 total" at 1 of 6
    When Focus is closed with Escape after position coverage
    Then the Focus position bar is gone and the opener is focused

  Scenario: Filtered progress follows the filtered navigation list
    When Focus opens with a two-image date filter
    Then Focus position is "Image 1 of 2 filtered" at 1 of 2
    When Focus advances one filtered image
    Then Focus position is "Image 2 of 2 filtered" at 2 of 2
    When the image filter is cleared after closing Focus
    Then Focus position is "Image 5 of 6 total" at 5 of 6

  Scenario: An active filter matching every image still identifies filtered progress
    When Focus opens with an all-matching image filter
    Then Focus position is "Image 1 of 6 filtered" at 1 of 6

  Scenario: Sorted and single-result positions reflect navigable order
    When Focus opens after sorting video first
    Then Focus position is "Image 1 of 6 total" at 1 of 6
    And the focused media is the first video
    When Focus opens with a single-image filter
    Then Focus position is "Image 1 of 1 filtered" at 1 of 1

  Scenario: Progress stays centered with uneven header content on desktop and phone
    When Focus opens on the first image for position coverage
    And the Focus header has long filenames and location information with an EXIF warning
    Then the Focus position group is centered and the header controls do not overlap
    When the Focus window becomes medium desktop sized
    Then the Focus position group is centered and the header controls do not overlap
    When the Focus window becomes tablet sized
    Then the Focus position group is centered and the header controls do not overlap
    When the Focus window becomes narrow
    Then the Focus position group is centered and the header controls do not overlap
    When the Focus window becomes very narrow
    Then the Focus position group is centered and the header controls do not overlap

  Scenario: Switching uploads resets the full-list position and count
    When Focus opens on the first image for position coverage
    Then Focus position is "Image 1 of 6 total" at 1 of 6
    When the second upload is opened for position coverage
    Then Focus position is "Image 1 of 2 total" at 1 of 2

  Scenario: An exhausted filter shows the empty-results state without a false position
    When the image filter has no matches for position coverage
    Then the empty-results state has no position bar
