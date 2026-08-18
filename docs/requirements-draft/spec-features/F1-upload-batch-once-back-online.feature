# DRAFT — for review, not yet agreed. Generated 2026-08-06 from docs/user-stories.md (Story F1) and the SPARCd requirements wiki User Stories page.

@F1
Feature: Upload a batch of images once back online

  """
  As a field worker, I want to upload the images from an SD card after I
  regain internet access, so that the captured data enters the system for
  identification.
  """

  Frank works for days without internet. Nothing about capturing, carrying
  or preparing a batch may require a connection; the connection is only
  needed at the moment he chooses to upload.

  Background:
    Given Frank has a set of images from one SD card
    And Frank is a member of the collection he intends to upload to

  @F1
  Scenario: Every image in a batch is stored and retrievable after a completed upload
    Given Frank has chosen a target collection for the batch
    When the upload completes
    Then every image from that batch is stored in the target collection
    And every image from that batch can be retrieved from that collection afterwards

  @F1
  Scenario: Preparing a batch requires no connection until Frank chooses to upload
    Given Frank has no internet access
    When Frank prepares the batch from the SD card for upload
    Then he can complete every preparation step without a connection
    And no work is lost when he later regains a connection and starts the upload

  @F1
  Scenario: A partial transfer is never presented as a completed upload
    Given an upload of the batch has begun
    When only some of the images have transferred
    Then the upload is shown as incomplete
    And it is not reported as finished to Frank or to anyone else
    And the collection does not present the batch as a completed upload

  @F1
  Scenario: Frank can tell at a glance whether he is currently able to upload
    Given Frank opens the upload workflow
    When there is no internet connection available
    Then he is clearly told that he is offline
    And when the connection returns, the indication changes to show he is online

  @F1
  Scenario: An incomplete upload continues from where it stopped
    Given an upload of the batch stopped before all images transferred
    When Frank returns to that upload
    Then he can continue it from the point it stopped
    And the images already transferred are not transferred again

  @F1
  Scenario: Only image files are taken from the SD card
    Given the SD card also contains files that are not images
    When Frank uploads the batch from that SD card
    Then only the image files are uploaded
    And the non-image files on the card are left out of the upload

  @F1
  Scenario: An upload that never completes does not add images to the collection
    Given an upload of the batch was abandoned before it completed
    When someone views the target collection
    Then the abandoned batch's images are not presented as part of the collection's data
