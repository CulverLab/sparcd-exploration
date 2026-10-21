# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/sections/Tag.tsx — handleKey/SortBar/find-image, src/components/Overview.tsx, src/components/Cheatsheet.tsx, src/components/ImageAdjustments.tsx, src/lib/selection.ts, src/lib/bursts.ts, src/lib/sortImages.ts, src/lib/imageSearch.ts).

@unmapped
Feature: Move through an upload and choose which images an action applies to

  """
  As-built flow: the workspace has an Overview (grid or list) and a Focus view
  of one image. Keyboard accelerators drive navigation and selection so a long
  upload can be worked through without the mouse; every keyboard action has an
  on-screen equivalent for touch.
  """

  Background:
    Given an upload is open in the tagging workspace

  @unmapped
  Scenario: The upload can be surveyed as a grid or as a list
    Then the Overview can be switched between a grid of tiles and a list of rows
    And the workspace shows the position of the focused image within the upload
    And the Focus view keeps the species picker beside the enlarged image

  @unmapped
  Scenario: List rows expose the useful image details without ambiguous status clutter
    Given an image has meaningful review markers
    When the detailed Overview list is opened
    Then list columns follow the Name, Type, Date, Species sort-control order
    And image and video rows identify their media type
    And long column values preserve their full accessible text
    And row numbers and the old species indicator are absent
    And meaningful edit and questionable markers remain accessible
    And a narrow Overview keeps filenames visible in its compact rows
    And the Focus strip keeps filename and species but omits the detail columns

  @unmapped
  Scenario: The workspace reminds the tagger which collection and upload they're viewing
    Then the collection name and upload name are shown

  @unmapped
  Scenario: Images can be stepped through from the keyboard in either view
    When the next-image or previous-image key is pressed
    Then focus moves one image in that direction
    And Left and Right also move one image in that direction
    And it stops at the first and last image of the upload
    And any selection is cleared by the move

  @unmapped
  Scenario: The image filter narrows the Overview by species text
    When the image filter is opened and searches species for "Coyote"
    Then only the matching image remains in the Overview

  @unmapped
  Scenario: The image filter combines capture date and untagged status
    When the image filter limits capture time to 2024-01-11 06 and untagged images
    Then only IMG005.JPG remains in the Overview

  @unmapped
  Scenario: Filtering clears a selection with no visible images
    Given several images are selected
    When the image filter limits capture time to 2024-01-11 06 and untagged images
    Then no hidden images remain selected for bulk actions

  @unmapped
  Scenario: A species key does nothing once the filter hides the last visible image
    When the image filter limits capture time to 2024-01-11 06 and untagged images
    And the only visible image is tagged and drops out of the filter
    And another species key is pressed with nothing left visible
    Then the image that dropped out carries only the species given while it was visible

  @unmapped
  Scenario: Text filtering covers filenames and timestamps and can be restricted
    When the image filter searches all fields for "IMG002"
    Then only "IMG002.JPG" remains in the Overview
    When the image filter searches all fields for "2024-01-10T22:15"
    Then only "IMG003.JPG" remains in the Overview
    When the image filter searches filenames only for "Coyote"
    Then no images match the image filter

  @unmapped
  Scenario: The image filter closes with Escape and returns focus to its control
    When the image filter is opened and dismissed with Escape
    Then the Filter control is collapsed and focused

  @unmapped
  Scenario: Focus navigation stays inside filtered images
    When the image filter limits Focus to the 2024-01-11 06 images
    And the next filtered image key is pressed in Focus
    Then IMG005.JPG is the focused filtered image

  @unmapped
  Scenario: Arrow-key navigation in a filtered Overview advances by filtered position, not raw list position
    When the image filter limits the Overview to untagged images
    And the first untagged match is focused
    And the next-image or previous-image key is pressed
    Then the second untagged match is focused
    # #442: the raw-list-order neighbors between the first and second untagged
    # matches (IMG003, IMG004) are tagged and hidden by the filter — stepping
    # by raw list position would land on one of them, outside the filter, and
    # snap back to the first match instead.

  @unmapped
  Scenario: Auto-advance after tagging skips a raw-list neighbor the filter hides
    When the image filter limits the Overview to tagged images
    And the first matching image in the Overview is focused
    And it is tagged with a species it doesn't already carry
    Then the next matching image is focused, skipping the one the filter hides
    # #442: auto-advance stepped by raw list position regardless of the
    # filter, with the same consequence as the scenario above.

  @unmapped
  Scenario: The image filter panel fits a narrow viewport
    When the image filter is opened in a narrow viewport
    Then the image filter panel stays within the viewport

  @unmapped
  Scenario: An image can be opened from the Overview and paged from the Focus view
    Given the Overview is shown
    When the focused image is opened
    Then the Focus view shows that image
    And on-screen previous and next controls move between images there at every viewport size

  @unmapped
  Scenario: Browser Back closes the Focus viewer before leaving the workspace
    Given the Overview is shown
    And the workspace has a browser history entry
    When the focused image is opened
    And the browser Back button is pressed
    Then the Focus viewer is closed and the Overview is shown
    And the image opener has focus again

  @H1
  Scenario: Focus traps keyboard navigation and Escape restores the opener
    Given the Overview is shown
    When the focused image is opened
    Then Tab wraps within the Focus viewer at both boundaries
    When Escape is pressed in Focus
    Then the Focus viewer is closed and the Overview is shown
    And the image opener has focus again

  @H1
  Scenario: Escape in Focus clears a pending count before closing the viewer
    Given the Overview is shown
    When the focused image is opened
    And count 3 is pending
    When Escape is pressed in Focus
    Then no pending species count is shown
    And the Focus viewer remains open
    When the bound species key is pressed in Focus
    Then the focused image carries that species at count one

  @H1
  Scenario: Closing Focus with its close control restores the opener
    Given the Overview is shown
    When the focused image is opened
    And the Close Focus control is clicked
    Then the Focus viewer is closed and the Overview is shown
    And the image opener has focus again

  @unmapped
  Scenario: The upload can be ordered by name, type, date or species count
    When a sort field is chosen
    Then the images are ordered by that field
    And choosing the same field again reverses the order
    And images that tie keep their original file order

  @unmapped
  Scenario: Re-ordering keeps focus and selection on the same images
    Given some images are selected and one is focused
    When the sort order is changed
    Then the same images remain selected
    And the same image remains focused, at its new position

  @unmapped
  Scenario: An image can be found by its file name
    When part of a file name is typed into the image search
    Then focus jumps to the first matching image
    And the number of matches and the current match position are shown
    And the matches can be cycled forwards and backwards
    And clearing the search leaves the upload's order untouched

  @unmapped
  Scenario: The / key focuses the image search from anywhere in the workspace
    Given the image search is not focused
    When "/" is pressed
    Then the image search has the keyboard focus

  @unmapped
  Scenario: Images are selected by clicking, extending or adding
    Given the Overview is shown
    When an image is clicked
    Then only that image is selected as the focus
    And shift-clicking another image selects the whole range between them
    And command- or control-clicking adds or removes a single image from the selection

  @unmapped
  Scenario: Starting an additive selection on another image keeps the focused image
    Given the Overview is shown
    When an image is clicked
    Then only that image is selected as the focus
    And an additive click on another image selects both images

  @unmapped
  Scenario: A selection can be built and cleared without a pointer
    Then a selected count is shown in place of the position when a selection exists
    And pressing Escape clears the selection
    And an on-screen control adds or removes the focused image from the selection on touch

  @unmapped
  Scenario: Rapid sequences can be grouped and worked as a unit
    Given burst grouping is switched on in Settings
    Then images from the same camera taken within the configured window are banded together
    And each band states how many images it holds and the time it spans
    And the whole band can be selected in one action
    And the burst-forward and burst-back keys jump between bands

  @unmapped
  Scenario: A missing capture time never merges two sequences
    Given an image has no capture time
    Then it starts a new burst rather than joining the previous one

  @unmapped
  Scenario: The keyboard accelerators are discoverable
    When the help key is pressed or the on-screen help control is used
    Then the shortcut reference is shown, grouped by navigating, tagging and selecting
    And it can be dismissed with the same key, with Escape, or with its close control
    And no tagging or navigation keystroke takes effect while it is open

  @unmapped
  Scenario: Accelerators stand down while text is being typed
    Given auto-advance is switched off in Settings
    And the cursor is in a text field
    Then letter keys type into that field rather than applying species
    And pressing Enter in the species filter applies the top match and leaves the field
    And pressing Enter in the image search moves to the next match instead of tagging

  @unmapped
  Scenario: Accelerators stand down while a video or a dialog has the keyboard
    Given a video is being played or scrubbed
    Then its own playback keys work and no tagging keystroke fires
    And while the sync, snapshots or time-shift dialog is open no image behind it is tagged or navigated

  @unmapped
  Scenario: The Adjust popup reserves native range keys while Tagger shortcuts still work
    Given auto-advance is switched off in Settings
    And a slider in the Adjust popup is focused
    Then a species key still applies that species to the focused image
    And Home, End, Page Up, Page Down, and arrow keys adjust the slider rather than navigating images
    And command- or control-S still saves while the slider is focused

  @unmapped
  Scenario: Escape from a focused slider closes the Adjust popup and leaves the selection alone
    Given a burst is selected and a slider in the Adjust popup is focused
    When Escape is pressed with the slider focused
    Then the Adjust popup closes and the same images are still selected

  @unmapped
  Scenario Outline: Filtered Overview crosses a hidden gap from the second match and back
    Given three untagged matches have hidden images between them
    When the image filter limits the Overview to untagged images
    And the second separated match is chosen
    And "<next>" is pressed in the filtered Overview
    Then the third separated match is focused
    When "<next>" is pressed in the filtered Overview
    Then the third separated match is focused
    When "<previous>" is pressed in the filtered Overview
    Then the second separated match is focused

    Examples:
      | next       | previous  |
      | ArrowDown  | ArrowUp   |
      | ArrowRight | ArrowLeft |

  @unmapped
  Scenario: Auto-advance keeps list order when tagging removes the current match
    When the image filter limits the Overview to untagged images
    And the first untagged match is focused
    And the focused untagged image is identified
    Then the second untagged match is focused
    And the identified image has disappeared from the filtered Overview

  @unmapped
  Scenario Outline: Exhausted auto-advance retains its position without jumping backward
    When the image filter limits the Overview to untagged images
    And the image filter excludes the video
    And the final image match is opened in "<view>"
    And the focused untagged image is identified
    Then exhausted focus stays on the image just identified in "<view>"
    When another species key is pressed after exhaustion
    Then only the original identification was applied and earlier matches remain untouched
    When the previous filtered match is requested in "<view>"
    Then the earlier matching image is reachable in "<view>"

    Examples:
      | view     |
      | Overview |
      | Focus    |

  @unmapped
  Scenario: Changing the filter releases an exhausted focus hold
    When the image filter limits the Overview to untagged images
    And the image filter excludes the video
    And the final image match is opened in "Overview"
    And the focused untagged image is identified
    Then exhausted focus stays on the image just identified in "Overview"
    When the filter is narrowed to the earlier matching image
    Then the earlier matching image is reachable in "Overview"

  @unmapped
  Scenario: A bulk edit does not advance into another match it just removed
    When the image filter limits the Overview to untagged images
    And the image filter excludes the video
    And both image matches are selected with the earlier match focused
    And the focused untagged image is identified
    Then exhausted bulk focus stays at the earlier image and all matches are removed

  @unmapped
  Scenario Outline: Exhausted focus survives live Species sorting
    When the images are sorted by Species ascending
    And the image filter limits the Overview to untagged images
    And the image filter excludes the video
    And the final image match is opened in "<view>"
    And the focused untagged image is identified
    Then the sorted exhausted focus remains on IMG005 in "<view>"
    When another species key is pressed after exhaustion
    Then only the original identification was applied and earlier matches remain untouched

    Examples:
      | view     |
      | Overview |
      | Focus    |
