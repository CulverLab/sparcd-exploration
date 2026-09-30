# Coverage for the H2 security outcome: identify permission is independent of
# the exactLocations permission, so saving an identification cannot disclose a
# deployment's coordinates.

@H2 @security
Feature: Identify new uploads without exposing protected coordinates

  @H2 @security @H2-7
  Scenario: Identifying a new-upload image does not reveal its protected location
    Given the tagger is connected with credentials that can read a collection
    And the connected account cannot read exact coordinates
    And an upload is open in the tagging workspace
    And a tagger identity has been set in Settings
    When the user identifies the focused image and syncs it
    Then the identification is saved
    And the saved identification does not disclose precise coordinates
