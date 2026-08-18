# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story F3) and the SPARCd requirements wiki User Stories page.

@F3
Feature: Announce that new data is ready to be tagged

  """
  As a field worker, I want to let the identification team know that new
  images have been uploaded, so that the species in them get identified
  promptly.
  """

  The announcement exists so identification starts promptly. It must say
  enough to act on, and no more — an announcement must never become a way
  for sensitive locations to travel to people not authorized to see them.

  Background:
    Given Frank has uploaded a batch of images to a collection

  @F3
  Scenario: The identification team can see that new untagged data is available
    When the upload completes
    Then the people responsible for identifying that collection can see that new, untagged data is available

  @F3
  Scenario: The announcement says what was uploaded
    When the upload completes
    Then the announcement identifies the collection
    And it identifies the location or locations the data came from
    And it states how many images were uploaded
    And it states the date of the upload

  @F3
  Scenario: A failed upload announces nothing
    Given the upload failed before completing
    When Frank looks at what the identification team was told
    Then no announcement of new data was made for that upload

  @F3
  Scenario: An abandoned upload announces nothing
    Given Frank abandoned the upload before completing it
    Then no announcement of new data was made for that upload

  @F3 @security
  Scenario: An announcement does not reveal a protected location
    Given the upload includes images from a location designated as sensitive
    When the announcement reaches someone not authorized for that sensitive location
    Then the announcement does not disclose the precise sensitive location
    And it does not disclose the sensitive species designation for that location

  @F3
  Scenario: Frank can add his own notes to the announcement
    When Frank announces the upload
    Then he can include free-text notes for the identification team
    And the announcement is still valid if he adds no notes
