@AL2
Feature: Failed upload leftovers stay hidden

  Background:
    Given the tagger is connected

  @AL2 @AL2-3
  Scenario: An interrupted upload without UploadMeta is not presented
    Given a failed upload left blobs and CSVs without its UploadMeta marker
    When a collection is selected
    Then that incomplete upload is not listed
    And the completed uploads remain listed
