# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/sections/Browse.tsx, src/lib/s3.ts — loadUploadSummary/presignImage, src/sections/Tag.tsx — Focus location label, src/lib/workspace.ts). Nothing in apps/sparcd-tagger references sensitive species or location protection.

@F4
Feature: What the tagger reveals about where images were taken

  """
  As a field worker, I want confidence that uploading images of endangered
  species will not reveal where those species are, so that I don't put the
  animals — or myself — at risk of unwanted attention.
  """

  As-built: the tagger shows the camera location recorded for each upload and
  the location name and ID in Focus. It has no concept of a sensitive
  species or a protected location, so it applies no restriction of its own —
  what a person sees is whatever their S3 credentials can read. Recorded here
  so the gap between F4/M1 and the tool as built is explicit for review.

  Background:
    Given the tagger is connected with credentials that can read a collection

  @F4
  Scenario: Each upload's camera location is shown in the upload list
    When a collection's uploads are listed
    Then each upload shows the location name(s) recorded in its deployment file
    And no location is withheld on the grounds of the species in the images

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
  Scenario: The tagger applies no species-based or location-based restriction
    When any view, dialog or synced file is produced
    Then no species is treated as sensitive
    And no location is hidden, coarsened or withheld from any connected user
    # There is no sensitive designation anywhere in the tagger. Access is
    # entirely determined by the credentials the user connects with and by
    # what those credentials are permitted to read. Flag for review: F4's
    # "the protection state of the upload is clear before committing" and
    # M1's "precise locations never visible to unauthorized users" are not
    # addressed inside this tool.

  @F4
  Scenario: Image links are time-limited but not otherwise restricted
    When an image is displayed
    Then it is fetched through a link signed with the connected credentials
    And that link expires about an hour after it is issued
    And it grants whatever the connected credentials already grant, no less
