# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-uploader (src/components/PublishedUploads.tsx, src/lib/publishedEdit.ts, src/lib/s3.ts, test/publishedEdit.test.ts) and packages/s3-safe/src/index.ts.

@unmapped
Feature: Correct a published upload

  """
  As-built flow: shown at the bottom of History. Two mistakes are correctable
  after an upload has been published — its description, and a misassigned camera
  location. Both are guarded: the previous contents are snapshotted first, the
  change only applies if the file is still exactly as it was when it was read,
  and every correction is recorded on the upload itself.
  """

  Background:
    Given the uploader is connected
    And a collection with published uploads has been selected in History

  @unmapped
  Scenario: The published uploads of a collection can be listed and searched
    Then each published upload is listed with its uploader, its upload date, its description, how many of its images carry a species, and its deployment
    And the list can be filtered by uploader, description, upload folder or deployment
    And the newest upload is listed first

  @unmapped
  Scenario: A published upload's description can be corrected
    When a new description is saved for an upload
    Then the upload's metadata file carries the new description
    And every other value in that file is left exactly as it was

  @unmapped
  Scenario: A misassigned camera location can be re-pointed
    When a different location is chosen for a published upload
    Then the deployment row is rewritten with that location's identifier, name, coordinates and elevation
    And the deployment reference on every media and observation row is updated to match
    And no other column or row in those files is changed

  @unmapped
  Scenario: The previous contents are preserved before anything is changed
    When a correction is applied
    Then the current contents of each file about to change are written to an immutable snapshot first, together with a manifest naming them
    And only then is the change applied

  @unmapped
  Scenario: A correction is refused if the upload changed since it was read
    Given a file to be corrected changed after it was loaded for review
    When the correction is applied
    Then it is refused as a conflict
    And nothing is written — not even a snapshot
    And the tool asks for a reload and a retry

  @unmapped
  Scenario: Every correction is recorded on the upload
    When a description correction is applied
    Then a note recording who edited it and when is appended to the upload's metadata file
    And previously recorded edits are kept and can be listed on the upload

  @unmapped
  Scenario: A correction that changes nothing writes nothing
    When a correction is applied whose values already match what is stored
    Then the tool reports that there is nothing to change
    And no snapshot and no change is written
    # Only a location correction can reach this: a description save always
    # appends an edit comment, so its bytes always differ from what is stored
    # even when the description itself is unchanged.

  @unmapped
  Scenario: A dry-run correction lists what it would write and touches nothing
    Given dry run is switched on
    When a correction is applied
    Then the tool lists the files it would replace
    And nothing is written, not even a snapshot

  @unmapped
  Scenario: An endpoint that will not enforce the guard disables corrections
    Given the storage endpoint does not enforce the conditional-replacement guard
    When a correction is applied
    Then the tool reports that corrections are unsupported on that endpoint
    And no unguarded overwrite is attempted
