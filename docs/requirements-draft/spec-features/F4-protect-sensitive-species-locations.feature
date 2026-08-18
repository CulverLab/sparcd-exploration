# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story F4, and misuse cases M1 and M2) and the SPARCd requirements wiki User Stories page.

@F4 @security
Feature: Never expose the location of endangered species

  """
  As a field worker, I want confidence that uploading images of endangered
  species will not reveal where those species are, so that I don't put the
  animals — or myself — at risk of unwanted attention.
  """

  This feature states the guarantees an outside observer could check, in
  adversarial terms as well as Frank's. Some scenarios describe what must be
  true of exports, metadata and stored records rather than of a screen, and
  may only be checkable by inspection rather than by using the product
  normally. That is deliberate: the guarantee is what matters, not where it
  is observed.

  Background:
    Given a species is designated as sensitive
    And images of that species have been uploaded from a camera location

  @F4 @security
  Scenario: Precise sensitive locations are invisible to anyone outside the authorized members
    When someone who is not an authorized member of the collection views the data
    Then the precise location of the sensitive-species images is not shown to them

  @F4 @security
  Scenario: Precise sensitive locations are absent from exports and reports
    When an unauthorized user obtains an export or report drawn from the collection
    Then the precise location of sensitive-species records does not appear anywhere in it

  @F4 @security
  Scenario: A precise sensitive location cannot be recovered indirectly
    Given an unauthorized user has whatever data they are permitted to see
    When they examine image metadata, file names, file paths, identifiers and aggregated results
    Then none of these lets them determine the precise location of a sensitive-species record

  @F4 @security
  Scenario: Permission to view or identify images does not by itself reveal sensitive locations
    Given a user is authorized to view and identify images in the collection
    And that user has not been explicitly authorized for sensitive locations
    When they work with sensitive-species images
    Then they can carry out identification
    But the precise location of those images is not disclosed to them

  @F4 @security
  Scenario: Frank is told the protection state before he commits to an upload
    Given Frank is preparing an upload that may include a sensitive species or location
    When he reaches the point of committing the upload
    Then he is shown whether the location of that upload will be protected
    And he can see this before the upload is committed, not only afterwards

  @F4 @security
  Scenario: Protection cannot be removed silently
    When a sensitive designation is removed, or a protected location is made visible
    Then the change requires appropriate authorization
    And the change is recorded together with who made it
    And it does not take effect without being visible to the collection's authorized members

  @F4 @security
  Scenario: A single compromised account cannot widen sensitive-location exposure
    Given one account has been compromised or acts maliciously
    When that account attempts to reach sensitive locations beyond its authorized scope
    Then no sensitive location outside that account's authorized scope is disclosed

  @F4 @security
  Scenario: Data in unauthorized collections cannot be read, changed or deleted
    Given a user is not authorized for a collection
    When they attempt to read, modify or delete that collection's data
    Then the attempt is refused
    And no part of it is carried out

  @F4 @security
  Scenario: Original uploaded data survives every later change
    Given images and their original upload record exist in a collection
    When a later change is made to that upload's data
    Then the original uploaded data is not destroyed
    And it is not overwritten without a trace
    And the change is traceable to the person who made it

  @F4 @security
  Scenario: An action outside a user's permissions is refused outright
    Given a user attempts an action their permissions do not allow
    When the attempt is processed
    Then it is refused in full
    And no part of the action is applied
