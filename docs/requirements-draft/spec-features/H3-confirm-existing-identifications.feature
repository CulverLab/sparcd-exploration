# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story H3) and the SPARCd requirements wiki User Stories page.

@H3
Feature: Confirm species already identified in existing uploads

  """
  As a species identifier, I want to review and confirm identifications that
  already exist on an upload, so that prior work is validated rather than
  redone.
  """

  Existing identifications represent someone else's work. Harold's job is to
  validate it — agreeing, correcting or removing — and the record must show
  that a review happened and who did it.

  Background:
    Given an image already carries identifications made by someone else
    And Harold has access to the collection that image belongs to

  @H3
  Scenario: Existing identifications are shown when Harold opens the image
    When Harold opens the image
    Then the species already identified on it are shown to him
    And the counts recorded for each of those species are shown to him

  @H3
  Scenario: Harold can confirm an existing identification
    When Harold confirms an existing identification
    Then the identification remains as it was
    And the record shows that it has been reviewed

  @H3
  Scenario: Harold can correct an existing identification
    When Harold corrects an existing identification
    Then the corrected species is what the image now carries
    And the record shows that a correction was made

  @H3
  Scenario: Harold can remove an existing identification
    When Harold removes an existing identification
    Then the image no longer carries that identification
    And the record shows that it was removed

  @H3
  Scenario: A review records who carried it out
    When Harold confirms or corrects an existing identification
    Then the record shows that a review took place
    And it shows that Harold was the reviewer

  @H3
  Scenario: The original identifier's work remains attributable
    Given an identification was originally made by another person
    When Harold reviews it
    Then who originally made the identification remains visible
    And Harold's review is recorded in addition to it, not in place of it

  @H3 @security
  Scenario: A review does not destroy the original uploaded data
    When Harold corrects or removes an existing identification
    Then the original uploaded image and its upload record are unchanged
    And the change is traceable to Harold

  @H3 @unmapped
  Scenario: Harold can tell reviewed identifications from unreviewed ones
    Given some identifications on the upload have been reviewed and others have not
    When Harold looks at the upload
    Then he can tell which identifications have already been reviewed
