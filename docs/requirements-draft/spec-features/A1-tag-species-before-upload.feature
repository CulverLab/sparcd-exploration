# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story A1) and the SPARCd requirements wiki User Stories page.

@A1
Feature: Identify species before uploading

  """
  As a species identifier, I want to tag the species in my images before I
  upload them, so that the images and their identifications enter the system
  together in one pass.
  """

  Anita comes back from a single camera and prefers to do the identification
  while the visit is fresh, before she has a connection. Her tags must
  survive until she uploads, and must travel with the images in the same
  pass.

  Background:
    Given Anita has images that have not yet been uploaded

  @A1
  Scenario: Tags assigned without a connection are retained
    Given Anita has no internet connection
    When she assigns species to her images
    Then those tags are retained
    And they are still present when she next returns to the images

  @A1
  Scenario: Images and their tags enter the system in a single upload
    Given Anita has tagged species on her images
    When she uploads them
    Then the uploaded data contains both the images and the species she assigned
    And no separate later tagging step is required for those images

  @A1
  Scenario: Untagged images are accepted and marked as untagged
    Given Anita has tagged some of her images and left others untagged
    When she uploads them
    Then all the images are accepted, tagged and untagged alike
    And the untagged images are marked as untagged

  @A1
  Scenario: An upload with no tags at all is still accepted
    Given Anita has tagged none of her images
    When she uploads them
    Then the upload is accepted
    And every image in it is marked as untagged

  @A1 @unmapped
  Scenario: Tags made before upload are attributed to Anita
    Given Anita has tagged species on her images
    When the upload completes
    Then those identifications are attributed to Anita

  @A1
  Scenario: Tags are not lost while waiting for a connection
    Given Anita tagged her images and then waited days before regaining a connection
    When she uploads them
    Then every tag she assigned is present in the uploaded data
