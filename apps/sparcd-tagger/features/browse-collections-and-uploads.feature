# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/sections/Browse.tsx, src/lib/queries.ts, src/lib/s3.ts, src/lib/species.ts).

@unmapped
Feature: Find the upload that needs tagging

  """
  As-built flow: Browse is the entry point. The rail lists every collection
  the connected credentials can see; choosing one lists its uploads with how
  much of each is already tagged. Opening an upload moves into the tagging
  workspace.
  """

  Background:
    Given the tagger is connected

  @unmapped
  Scenario: Only collections the credentials can read are offered
    When Browse is opened
    Then the rail lists the collections readable with the connected credentials
    And when none are readable it says no collections are visible to these credentials

  @unmapped
  Scenario: The collection rail can be narrowed by name or organization
    Given several collections are listed
    When text is typed into the collection filter
    Then only collections whose name or organization contains that text remain
    And a message names the filter text when nothing matches

  @unmapped
  Scenario: The species vocabulary's load state is visible before tagging starts
    When Browse is opened
    Then the rail reports how many species were loaded and which settings bucket they came from
    And it reports how many entries were skipped as malformed
    And it reports the reason when the vocabulary cannot be read at all

  @unmapped
  Scenario: Each upload shows its date, uploader, location, size and tagging progress
    Given a collection is selected
    Then each upload row shows the upload date and time
    And it shows the account that made the upload, when the upload's name carries one
    And it shows the deployment location name(s) recorded for that upload
    And it shows the image count and how many of those images already carry a species

  @unmapped
  Scenario: An upload whose location file cannot be read still lists
    Given an upload has no readable deployment file
    When its row is shown
    Then the row still shows its date, image count and tagging progress
    And the location column is shown as empty rather than the row being hidden

  @unmapped
  Scenario: Uploads can be narrowed to those still needing work
    Given a collection's uploads have been tallied
    When the "In progress" tab is chosen
    Then only uploads with at least one image still lacking a species are listed
    And the "Done" tab lists only uploads where every image already carries a species
    And uploads whose tally has not finished loading appear only under "All"

  @unmapped
  Scenario: The collection header totals the work outstanding
    Given a collection is selected
    Then the header states how many uploads, images and tagged images it holds
    And it states how many images are still to go
    And it indicates while tallies are still being counted

  @unmapped
  Scenario: Each upload shows whether this browser holds unsynced edits for it
    Given local edits were made to an upload in this browser
    Then that upload's row is marked as having unsynced edits
    And an upload whose local edits have all been synced is marked as synced
    And an upload never edited on this machine is marked local-only

  @unmapped
  Scenario: Opening an upload moves into the tagging workspace
    Given a collection's uploads are listed
    When an upload is opened
    Then the tagger switches to the Tag section for that upload
    And the upload's canonical image list and existing identifications are loaded
