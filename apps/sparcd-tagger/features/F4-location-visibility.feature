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
    Then the location identity remains visible but precise coordinates and location editing do not

  @F4 @security @F4-4
  Scenario: Identify access does not reveal protected coordinates
    Given the connected account cannot read exact coordinates
    And an upload is open in the tagging workspace
    When the user identifies the focused image and automatic saving finishes
    Then the identification is saved
    And the saved identification does not disclose precise coordinates

  @F4
  Scenario: The focused image shows the location name and ID of its deployment
    Given an image is open in the Focus view
    Then the location name and ID recorded for that image's deployment are shown alongside its file name

  @unmapped
  Scenario: A missing deployment file leaves the location area blank in Focus
    Given an image is open in the Focus view for an upload with no readable deployment file
    Then no location is shown alongside its file name

  @unmapped
  Scenario Outline: Incomplete recorded location information leaves the Focus location blank
    Given the recorded deployment has <state>
    And an image is open in the Focus view
    Then no location is shown alongside its file name

    Examples:
      | state              |
      | an empty file      |
      | no location name   |
      | no location ID     |
      | whitespace fields  |

  @unmapped
  Scenario: A failed location refresh clears the label without closing Focus
    Given an image is open in the Focus view
    When the recorded location lookup becomes unreadable
    Then no location is shown alongside its file name

  @unmapped
  Scenario Outline: Long Focus locations leave room for the filename and Close control
    Given the recorded location has a long name and ID and the image has an EXIF warning
    And an image is open in the Focus view
    Then the Focus header fits at <width> pixels with its full accessible location

    Examples:
      | width |
      | 320   |
      | 390   |
      | 768   |
      | 1440  |

  @F4
  Scenario: The tagger applies no species-based restriction to permitted data
    When any view, dialog or synced file is produced
    Then no species is treated as sensitive
    And no location is hidden, coarsened or withheld when the connected account has exact-coordinate permission

  @F4 @security
  Scenario: Exact-coordinate permission preserves precise location data
    Given the connected account can read exact coordinates
    And an upload is open in the tagging workspace
    Then the exact coordinates remain available to the authorized account

  @F4
  Scenario: Image links are time-limited but not otherwise restricted
    When an image is displayed
    Then it is fetched through a link signed with the connected credentials
    And that link expires about an hour after it is issued
    And it grants whatever the connected credentials already grant, no less
