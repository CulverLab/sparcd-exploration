# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story H2) and the SPARCd requirements wiki User Stories page.

@H2
Feature: Identify species in new uploads

  """
  As a species identifier, I want to assign species to images in a new upload,
  so that the upload's data becomes usable for analysis.
  """

  An upload only becomes usable for analysis once its images carry species.
  Harold's identifications must be visible to his teammates and must clearly
  be his.

  Background:
    Given a new upload contains untagged images
    And Harold has access to the collection that upload belongs to

  @H2
  Scenario: An assigned species is saved and visible to others with access
    When Harold assigns a species to an untagged image
    Then that identification is saved
    And other people with access to the collection can see it on that image

  @H2
  Scenario: An image can carry more than one species
    Given an image contains more than one species
    When Harold assigns each of those species to the image
    Then the image carries all of the species he assigned
    And none of them replaces another

  @H2
  Scenario: Identifications are attributed to the person who made them
    When Harold assigns a species to an image
    Then the identification records that Harold made it
    And another identifier's work on other images is not attributed to Harold

  @H2 @unmapped
  Scenario: Only species valid for the collection can be assigned
    When Harold assigns a species to an image
    Then he can choose only from the species available for that collection

  @H2
  Scenario: An image Harold has identified is no longer counted as untagged
    Given Harold has assigned at least one species to a previously untagged image
    When the upload's remaining work is looked at
    Then that image is no longer counted among the untagged images

  @H2
  Scenario: Harold can leave an image he cannot identify without tagging it
    Given Harold cannot identify the species in an image
    When he moves on to the next image
    Then the image remains marked as untagged
    And no species is recorded for it

  @H2 @security
  Scenario: Identifying an image does not by itself reveal a protected location
    Given the image comes from a location designated as sensitive
    And Harold is not explicitly authorized for sensitive locations
    When he identifies the species in that image
    Then his identification is saved
    But the precise location of the image is not disclosed to him
