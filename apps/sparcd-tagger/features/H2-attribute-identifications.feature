@H2
Feature: Attribute identifications to the connected account

  As a species identifier, I want each new identification to name the storage
  account that made it, while preserving another identifier's existing work.

  Background:
    Given an upload is open in the tagging workspace
    And the species vocabulary has loaded
    And auto-advance is switched off in Settings

  @H2 @H2-3
  Scenario: Identifications are attributed to the person who made them
    Given Harold is connected as the storage account
    When Harold assigns a species to an image
    And the upload is synced
    Then the new identification records that Harold made it
    And another identifier's work on another image is not attributed to Harold
