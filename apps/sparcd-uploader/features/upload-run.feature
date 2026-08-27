# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-uploader (src/sections/Upload.tsx, src/lib/upload.ts, src/lib/bundle.ts, src/components/RunMonitor.tsx, packages/s3-safe/src/index.ts, test/upload.test.ts, test/bundle.test.ts).

Feature: Upload and publish a batch

  """
  As-built flow: step 4 of 4 ("Upload"). The batch's media is streamed to the
  collection under a single upload folder, each object verified after it lands.
  Only once every file has landed are the metadata files written — that final
  write is what makes the upload visible to the rest of SPARC'd, so a partly
  transferred batch never looks like a finished one.
  """

  Background:
    Given a batch has a collection, a deployment, an uploader identity and capture times
    And the New upload section is showing the Upload step
    # PR #26 fixed the old publish hang for fully examined batches. Scenarios
    # now use ordinary small media, except where the behavior under test is
    # explicitly about background examination or cancelling an in-flight write.

  @unmapped
  Scenario: A real upload is offered by default; a dry run is opt-in
    Given the upload has not been started
    Then dry run is switched off by default
    # Dry run resets to off for every new page load; it is not remembered.

  @unmapped
  Scenario: Switching dry run on lists every object that would be written, without writing it
    Given the upload has not been started
    When the operator opts into a dry run
    Then starting it lists every object that would be written, with its size and fingerprint
    And nothing is written to storage
    And the run is not recorded in History

  @unmapped
  Scenario: A real upload states what access it needs before it starts
    Then the tool states that a setup issue on the storage side is not the user's fault
    And that the collection ID is given to contact an administrator with

  @F1
  Scenario: Every file in the batch is stored under one upload folder in the collection
    When a real upload is started and completes
    Then every media file of the batch is stored under a single upload folder in the chosen collection
    And the folder is named for the moment of upload and the uploader's identity
    And each stored object's path is the one recorded for it in the media table

  @F1
  Scenario: Each stored object is verified after it is written
    When a file has been uploaded
    Then the tool re-reads the stored object's size and recorded fingerprint
    And a mismatch is treated as a failure of that file, not as a success
    # A mismatch is retried like any other transient failure. The retry then
    # re-PUTs a key the first attempt already stored, so the append-only guard
    # rejects it and the run stops there rather than working through the retry
    # budget — the file is never counted as done either way.

  @unmapped
  Scenario: Uploading begins before the whole batch has finished being examined
    Given some files are still being examined
    When the upload is started
    Then files that have already been examined start uploading immediately
    And each remaining file starts as soon as its own examination finishes
    And the tool reports how many files are still being examined

  @F1 @F3
  Scenario: The upload is only published once every file has landed
    Given a real upload is running
    Then the metadata files are written only after every file in the batch has been stored and verified
    And they are written in a fixed order, with the upload metadata file last but one and the completion record last
    # Upstream SPARC'd treats the presence of the upload metadata file as the
    # signal that the folder is complete, which is why it is written after the
    # media and the tables.

  @F1
  Scenario: A batch where some files failed is left unpublished and shown as partial
    Given a real upload in which some files failed after their retries
    Then no metadata files are written
    And the run is reported as partial, stating how many files failed
    And the tool states that the upload is not yet visible and can be completed by retrying the failed files

  @F3
  Scenario: An upload that fails or is abandoned announces nothing
    Given a real upload that was cancelled or ended in failure
    Then no upload metadata file was written for it
    And nothing reading the collection sees a new upload there
    # There is no notification mechanism as-built; publishing the metadata is the
    # only thing that makes an upload discoverable.

  @A1
  Scenario: A batch with no species identifications is accepted and recorded as untagged
    When a batch is published
    Then an empty observations table is written alongside the media table
    And the upload metadata records that none of its images carry a species
    # The uploader has no tagging surface at all; every upload it makes is
    # untagged by construction.

  @unmapped
  Scenario: Progress is reported per file and for the batch as a whole
    Given a run is in progress
    Then each file shows its own state and percentage
    And the batch shows bytes uploaded against the total, and counts of done, skipped and failed files
    And an activity log records each retry, each warning and each metadata write as it happens
    # Correction: a real upload does not log successful blob writes at all — the
    # log carries retries, warnings, skips, and the five metadata writes. The
    # per-object "PUT …" listing only appears in a dry run.

  @unmapped
  Scenario: The number of files uploaded at once can be tuned
    Given the upload has not been started
    Then the number of parallel uploads can be set between 4 and 16
    And it defaults to 8
    And it cannot be changed while a run is in progress
    # The setting lives on the Upload step, not in Settings, and is not
    # remembered across page loads.

  @unmapped
  Scenario: A momentary failure is retried before the file is given up on
    Given a file's upload fails with a network error, a server error or a clock-skew rejection
    Then it is retried up to five attempts with an increasing, randomized delay
    And the retry is recorded in the activity log

  @unmapped
  Scenario: A permission failure stops the whole run at once
    Given a file's upload is refused for lack of permission
    Then the run stops immediately without working through the remaining files
    And the failure is reported

  @unmapped
  Scenario: Many independent file failures are treated as a systemic problem
    Given ten files have failed independently in one run
    Then the run stops and reports that the problem looks systemic rather than per-file

  @unmapped
  Scenario: An object already present at the same path is never silently overwritten
    Given an object already exists at a path the run intends to write
    When a fresh upload attempts that write
    Then the write is refused rather than replacing the existing object
    And the run reports the failure
    # The storage wrapper offers no delete or copy operation, and its only
    # overwrite path is the reviewed edit-after-publish flow.

  @unmapped
  Scenario: A run can be cancelled
    When a run is cancelled
    Then in-flight transfers are abandoned
    And the run is reported as cancelled
    And files already stored remain stored
    # Cancelling a real run leaves the session open in History, so it can be
    # resumed later.

  @unmapped
  Scenario: Going back to Assign is blocked while a run is in progress
    Given a run is in progress
    Then the Back button is disabled

  @unmapped
  Scenario: The next batch from the same site keeps the previous choices
    Given a real upload has completed
    When "Next batch" is chosen
    Then the wizard returns to the Files step with an empty batch
    And the collection, deployment, uploader identity, description and timezone of the previous batch are kept
