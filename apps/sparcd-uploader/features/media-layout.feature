Feature: Store each image once, by content, in the collection's data bucket

  """
  A collection with a data bucket gets the Media layout: each image is stored
  once under Media/<sha256>/ in that bucket, named for its camera time and
  filename, and the upload's media.csv names it. The manifests still go to the
  upload folder, and media.csv is written last. A collection with only its
  legacy sparcd-<uuid> bucket keeps the old layout, images inside the upload
  folder. packages/camtrap/README.md has the whole layout.
  """

  Background:
    Given the store has a data bucket holding a collection

  @unmapped
  Scenario: A new upload stores its images by content and publishes media.csv last
    When a batch is uploaded to the data-bucket collection
    Then each image is stored once under its content hash in the data bucket, named for its camera time and filename
    And the metadata files are written to the upload folder in the data bucket
    And media.csv names each image by its stored key
    And media.csv is the last object written
    And every object written carries a content type

  @unmapped
  Scenario: The same images uploaded again under the same names are stored once
    Given a batch was uploaded to the data-bucket collection
    When the same files are uploaded to it again
    Then no image is written the second time
    And the second upload's media.csv names the images the first upload stored

  @unmapped
  Scenario: The same images uploaded again under other names are stored once
    Given a batch was uploaded to the data-bucket collection
    When the same images are uploaded to it again under other names
    Then no image is written the second time
    And the second upload's media.csv names the images the first upload stored

  @unmapped
  Scenario: A derived file alone does not count as the stored image
    Given the data bucket already holds a preview of an image but not the image itself
    When a batch is uploaded to the data-bucket collection
    Then the image is stored beside its preview

  @unmapped
  Scenario: A collection with only its legacy bucket keeps the old layout
    When a batch is uploaded to a collection that has only its legacy bucket
    Then every image is stored inside the upload folder in that bucket
    And nothing is written to the data bucket or its Media folder

  @unmapped
  Scenario: An image without a camera time is named for its estimated time
    When a batch with an image that has no camera time is uploaded to the data-bucket collection
    Then that image's key carries its estimated capture time

  @AL2
  Scenario: An interrupted upload resumes with the keys it planned
    Given an upload to the data-bucket collection was interrupted after some images were stored
    When it is resumed
    Then it stores the remaining image under the key it planned
    And no image is stored twice
    And media.csv names each image by its stored key
    And media.csv is the last object written
