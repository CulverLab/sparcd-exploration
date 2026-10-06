Feature: Tag uploads wherever the collection keeps them

  """
  As-built flow: one collection can keep uploads in a data bucket and in its
  legacy sparcd-<uuid> bucket. The tagger lists them together and reads and
  writes each upload in the bucket it was listed from. An upload stored by
  content has its images under Media/<sha256>/ in the data bucket, and its
  media.csv names them there. packages/camtrap/README.md has the whole layout.
  """

  Background:
    Given the collection also keeps uploads in a data bucket
    And the tagger is connected

  @unmapped
  Scenario: An upload stored by content opens, renders and syncs in the data bucket
    When the upload stored in the data bucket is opened
    Then its images render from their Media keys, signed against the data bucket
    Given a tagger identity has been set in Settings
    When a species is applied to one of its images and synced
    Then that upload's observations.csv in the data bucket records it
    And the observation id is built on the image's stamped name
    And nothing is written outside that upload's folder in the data bucket

  @unmapped
  Scenario: A collection split across a data bucket and its legacy bucket shows as one
    Then the collection is listed once in the rail
    When the collection is selected
    Then its uploads from both buckets are listed
    And an upload folder present in both buckets is listed once
    And that upload opens from the data bucket
    And an old-layout upload in the legacy bucket still opens and renders from there

  @unmapped
  Scenario: An upload folder without media.csv is not listed
    When the collection is selected
    Then the upload still being written is not listed
