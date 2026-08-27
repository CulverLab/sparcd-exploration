# DRAFT — for review, not yet agreed. Generated 2026-08-25 from apps/sparcd-tagger (src/App.tsx, src/components/Chrome.tsx, src/sections/Tag.tsx, src/lib/localBatch.ts, src/lib/localWorkspace.ts, src/lib/defaultSpecies.ts, src/lib/useMediaUrl.ts) plus packages/flip.

Feature: Tag a batch that has not been uploaded yet

  """
  As-built flow: the Uploader hands over a batch of images still sitting on the
  researcher's card and opens the tagger on it. There is no collection, so
  there is nothing to connect to: the workspace opens straight away, the images
  come from the folder on this machine, and the species list travels with the
  app. Tags go back into the hand-off record, and the Done button returns to
  the Uploader with them.
  """

  Background:
    Given the Uploader has handed over a batch of images

  @A1
  Scenario: The workspace opens with no connection at all
    Then no connection screen is shown
    And the images are listed ready to tag
    # Requirement A1: Anita tags before she has a connection.

  @A1
  Scenario: The chrome says whose batch this is and how to give it back
    Then the header says it is a local batch from the Uploader, with the file count
    And it offers "Done · back to Uploader"

  @unmapped
  Scenario: Collection-only tools are absent, not disabled
    Then there is no Browse, History, Sync or Snapshots
    # They all act on a collection, and these images are not in one yet.

  @A1
  Scenario: The species list is available with no connection
    Then the species panel lists species to apply

  @A1
  Scenario: A species applied to an image is kept on the batch
    When Coyote is applied to an image
    Then the batch records Coyote against that image

  @A1
  Scenario: Handing the batch back returns to the Uploader with the tags
    Given a species has been applied to an image
    When "Done · back to Uploader" is chosen
    Then the batch carries the tag for the Uploader to read
    And the browser goes back to the Uploader carrying the batch's id

  @unmapped
  Scenario: Done only ever goes to this site's own Uploader
    Given the batch points somewhere other than the Uploader to return to
    When "Done · back to Uploader" is chosen
    Then the browser goes to this site's Uploader anyway
    # Batches live in storage any page on this origin can write, so where a
    # batch says to go back to is not taken on trust.

  @A1
  Scenario: Coming back to the batch resumes the tagging
    Given a species has been applied to an image
    When the batch is opened again
    Then that image still carries its species

  @unmapped
  Scenario: A batch this browser does not have is explained, not crashed
    Given the link points at a batch that is not in this browser
    Then the workspace says there is no such batch
    And it explains that the two tools only share batches on the same origin
