# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story F2) and the SPARCd requirements wiki User Stories page.

@F2
Feature: Identify the camera location of each SD card's images

  """
  As a field worker, I want to specify which camera location each SD card came
  from during upload, so that every image is tied to the correct place.
  """

  Frank services several cameras on one trip and returns with several SD
  cards. Each card belongs to exactly one camera location, and no batch may
  reach the collection without that location recorded.

  Background:
    Given Frank has one or more batches of images, each from a single SD card
    And Frank has chosen the collection he is uploading to

  @F2
  Scenario: Only locations valid for the chosen collection can be assigned
    When Frank assigns a location to a batch
    Then he can choose only from the locations valid for that collection
    And locations belonging to other collections are not offered to him

  @F2
  Scenario: A location outside the collection cannot be assigned
    When Frank attempts to assign a location that is not valid for the chosen collection
    Then the assignment is refused
    And the batch remains without an assigned location

  @F2
  Scenario: An upload cannot be finalized while any batch is missing a location
    Given Frank is uploading more than one batch
    And at least one batch has no location assigned
    When Frank attempts to finalize the upload
    Then finalizing is not permitted
    And he is told which batches still need a location

  @F2
  Scenario: An upload can be finalized once every batch has a location
    Given every batch in the upload has a location assigned
    When Frank finalizes the upload
    Then the upload proceeds

  @F2
  Scenario: Each stored image carries the location Frank assigned to its batch
    Given Frank assigned a location to each batch
    When the upload completes
    Then every image's stored location matches the location assigned to the batch it came from

  @F2
  Scenario: Batches from different cards keep their own separate locations
    Given Frank uploads two batches from two different SD cards
    And each batch is assigned a different location
    When the upload completes
    Then the images of each batch carry only that batch's own location
