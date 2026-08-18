# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story A2) and the SPARCd requirements wiki User Stories page.

@A2
Feature: Specify the camera location while uploading

  """
  As a species identifier, I want to state which camera location my images
  came from as I upload them, so that the identifications are tied to the
  right place.
  """

  Anita typically visits one camera at a time, so she uploads one batch with
  one location. The identifications she has already made are only useful if
  they are tied to the correct place.

  Background:
    Given Anita has a batch of images from one camera
    And Anita has chosen the collection she is uploading to

  @A2
  Scenario: Only locations valid for her collection can be assigned
    When Anita assigns a location to her batch
    Then she can choose only from the locations valid for that collection
    And locations belonging to other collections are not offered to her

  @A2
  Scenario: A location outside her collection cannot be assigned
    When Anita attempts to assign a location that is not valid for her collection
    Then the assignment is refused
    And the batch remains without an assigned location

  @A2
  Scenario: The upload cannot be finalized without a location
    Given Anita's batch has no location assigned
    When she attempts to finalize the upload
    Then finalizing is not permitted
    And she is told that a location is still required

  @A2
  Scenario: The stored location matches what Anita assigned
    Given Anita assigned a location to her batch
    When the upload completes
    Then the stored location of every image in the batch matches the location she assigned

  @A2
  Scenario: The location applies to the identifications she already made
    Given Anita tagged species on her images before uploading
    And she assigned a location to the batch
    When the upload completes
    Then each of her identifications is tied to that location
