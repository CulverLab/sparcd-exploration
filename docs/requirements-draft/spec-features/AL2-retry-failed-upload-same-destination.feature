# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story AL2) and the SPARCd requirements wiki User Stories page.

@AL2
Feature: Retry a failed upload to the same destination

  """
  As a species identifier, I want to retry a failed upload to the same
  destination as the previous attempt, so that I don't create duplicate or
  misplaced uploads.
  """

  When an upload ultimately fails, Alice retries it. The retry must land in
  exactly the same place as the first attempt, must not make her redo work
  she already did, and must leave one upload behind — not two, and not one
  and a half.

  Background:
    Given Alice made an upload attempt that ultimately failed
    And that attempt had a collection and a location assigned
    And species had been identified on some of the images

  @AL2
  Scenario: The retry targets the same collection and location as the original attempt
    When Alice retries the failed upload
    Then the retry targets the same collection as the original attempt
    And it targets the same location as the original attempt

  @AL2
  Scenario: The destination ends up with exactly one upload
    When the retry completes
    Then the destination contains exactly one upload for that batch
    And there is no duplicate upload of the same batch

  @AL2
  Scenario: No leftover partial data from the failed attempt remains
    When the retry completes
    Then no partial data from the failed attempt remains in the destination
    And the images present are those of the completed retry

  @AL2
  Scenario: Retrying does not require re-entering the location
    When Alice retries the failed upload
    Then she is not required to choose the collection or location again

  @AL2
  Scenario: Retrying does not require re-identifying species already tagged
    Given Alice had identified species on images in the failed attempt
    When she retries the upload
    Then she is not required to identify those species again
    And when the retry completes, those identifications are present in the destination

  @AL2
  Scenario: A retry cannot be misdirected to a different destination by accident
    When Alice retries the failed upload
    Then the retry cannot silently land in a collection or location other than the original attempt's
