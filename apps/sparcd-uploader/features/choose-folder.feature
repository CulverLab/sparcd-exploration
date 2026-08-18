# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-uploader (src/components/DropZone.tsx, src/lib/scanFiles.ts, src/store.ts, test/scanFiles.test.ts).

Feature: Choose the folder of media to upload

  """
  As-built flow: step 1 of 4 ("Drop") of the New upload wizard. The user hands
  the tool a folder — normally the SD card — either by dragging it onto the page
  or through a folder picker. The tool reads the folder recursively and takes
  only the media types it can publish.
  """

  Background:
    Given the uploader is connected
    And the New upload section is showing the Drop step

  @F1
  Scenario: Only JPEG images and MP4 videos are taken from the chosen folder
    When a folder is chosen that also contains other files
    Then only the JPEG and MP4 files are listed for upload
    And every other file in the folder is ignored
    # A file counts as JPEG or MP4 by its reported media type, or by a .jpg /
    # .jpeg / .mp4 extension when the browser reports no type.

  @F1
  Scenario: Subfolders are read as part of the same batch
    Given the chosen folder contains subfolders of images
    When the folder is chosen
    Then media in every subfolder is included in the batch
    And each file keeps its path relative to the chosen folder

  @unmapped
  Scenario: A folder can be dragged onto the page or picked from a dialog
    When a folder is dragged onto the drop area
    Then its media is scanned exactly as if it had been picked from the dialog

  @unmapped
  Scenario: A folder that holds no usable media says so instead of continuing
    When a folder containing no JPEG or MP4 files is chosen
    Then the tool reports that the folder was read but held no images or videos
    And it stays on the Drop step so another folder can be chosen

  @unmapped
  Scenario: A device that cannot select whole folders offers individual files
    Given the browser cannot present a folder picker
    Then the drop area offers to choose individual photos or videos instead
    And it states that whole-folder selection is desktop-only

  @unmapped
  Scenario: Choosing a new folder replaces the previous batch
    Given a batch has already been scanned
    When another folder is chosen
    Then the earlier batch is discarded
    And examination starts over on the new batch

  @unmapped
  Scenario: The same file is never listed twice from one scan
    When a folder is scanned
    Then each distinct path within the folder appears at most once in the batch

  @unmapped @manual
  # Not automatable headlessly: showDirectoryPicker() opens a real OS folder
  # dialog that no synthetic event can satisfy.
  Scenario: Picking a folder through the dialog allows a later resume without re-picking
    Given the browser can grant lasting access to a chosen folder
    When the folder is chosen through the folder picker
    Then the tool remembers the folder for this upload
    And a later resume of that upload can read the same files after asking permission

  @unmapped
  Scenario: A dragged folder requires re-selection when an upload is resumed
    When a folder is supplied by dragging it onto the page
    Then no lasting access to that folder is retained
    And a later resume of that upload asks for the folder to be selected again

  @unmapped
  Scenario: Scanning is visible while it runs
    When a large folder is being read
    Then the drop area reports that the folder is being scanned
