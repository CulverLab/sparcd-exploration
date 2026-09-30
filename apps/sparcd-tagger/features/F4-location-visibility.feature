# DRAFT — for review, not yet agreed. The access proxy controls exact-coordinate
# visibility; the Tagger keeps location identity and elevation usable when the
# proxy returns redacted coordinates.

@F4
Feature: What the tagger reveals about where images were taken

  """
  As a field worker, I want confidence that uploading images of endangered
  species will not reveal where those species are, so that I don't put the
  animals — or myself — at risk of unwanted attention.
  """

  As-built: the tagger shows the camera location identity recorded for each
  upload and the deployment identifier of each image. The access proxy decides
  whether exact coordinates are returned; the Tagger applies no species-based
  designation of its own.

  Background:
    Given the tagger is connected with credentials that can read a collection

  @F4
  Scenario: Each upload's camera location is shown in the upload list
    When a collection's uploads are listed
    Then each upload shows the location name(s) recorded in its deployment file
    And no location is withheld on the grounds of the species in the images

  @F4 @security @F4-1
  Scenario: Precise coordinates remain hidden without coordinate permission
    Given the connected account cannot read exact coordinates
    Given a collection's uploads are listed
    Then the location identity and elevation remain visible but its precise coordinates do not

  @F4
  Scenario: The focused image shows the deployment it belongs to
    Given an image is open in the Focus view
    Then the deployment identifier recorded for that image is shown alongside its file name

  @F4
  Scenario: The tagger applies no species-based restriction to permitted data
    When any view, dialog or synced file is produced
    Then no species is treated as sensitive
    And no location is hidden, coarsened or withheld when the connected account has exact-coordinate permission

  @F4
  Scenario: Image links are time-limited but not otherwise restricted
    When an image is displayed
    Then it is fetched through a link signed with the connected credentials
    And that link expires about an hour after it is issued
    And it grants whatever the connected credentials already grant, no less
