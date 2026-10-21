# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/sections/Tag.tsx — FocusPane/ZoomableImage/Lightbox/ZoomControls, src/components/Overview.tsx, src/components/Thumb.tsx, src/components/ImageAdjustments.tsx, src/lib/adjustments.ts).

@H1
Feature: Examine an image closely enough to catch every species

  """
  As a species identifier, I want to zoom into and out of an image, so that I
  can spot species that are small, distant, or partly hidden.
  """

  As-built: the Focus view shows one image fitted to the pane, with zoom, pan,
  a fullscreen mode and view-only display adjustments. Zoom state belongs to
  the image being viewed and is discarded when another image is opened.

  Background:
    Given an upload is open in the tagging workspace
    And an image is shown in the Focus view

  @H1
  Scenario: Focus gives the image the largest available canvas beside the species picker
    Then the Focus image canvas fills the available area beside the species picker

  @unmapped
  Scenario: The species panel's width can be dragged narrower or wider
    When the species panel's divider is dragged narrower
    Then the species panel is narrower and the image canvas is wider
    When the species panel's divider is dragged wider
    Then the species panel is wider than its default width

  @unmapped
  Scenario: The species panel never gives up all its width
    When the species panel's divider is dragged as far narrow as it will go
    Then the species panel stays at least 100px wide

  @unmapped
  Scenario: The image canvas keeps a usable minimum width too
    When the species panel's divider is dragged as far wide as it will go
    Then the image canvas does not shrink away to nothing

  @unmapped
  Scenario: A chosen width is remembered the next time Focus opens
    Given the species panel's divider has been dragged to a new width
    When Focus is closed and reopened
    Then the species panel keeps the width that was chosen

  @unmapped
  Scenario: On a phone, the same divider resizes height instead of width
    Given the viewport is narrowed to a phone size
    When the species panel's divider is dragged shorter
    Then the species panel is shorter and the image canvas is taller

  @unmapped
  Scenario: The divider can be resized from the keyboard
    When the species panel's divider is focused
    And the narrowing arrow key is pressed
    Then the species panel becomes narrower

  @unmapped
  Scenario: Split bounds and preferences survive window changes and reload
    Then split preferences survive resizing and reload without hiding controls

  @unmapped
  Scenario: The phone divider supports actual touch input
    Then a touch drag resizes the phone split

  @unmapped
  Scenario: Cancellation and Focus closing stop divider drags
    Then canceled and unmounted drags stop resizing

  @H1
  Scenario: An image can be enlarged well beyond its fit-to-screen size
    When the image is zoomed in
    Then it can be enlarged up to six times its fitted size
    And detail beyond the fitted view becomes legible

  @H1 @H1-2
  Scenario: The enlarged image can be moved around
    Given the image is zoomed in
    When it is dragged
    Then the visible part of the image moves with the drag
    And it cannot be dragged beyond the edges of the image

  @H1
  Scenario: Zoom can be driven without a mouse wheel
    Then on-screen zoom-in and zoom-out controls are available over the image
    And double-clicking the image zooms in a step

  @H1 @H1-3
  Scenario: Returning to the fitted view is one action away once zoomed
    Given the image is zoomed in
    Then a "Reset" control is offered
    And using it returns the image to the fitted view
    And the control is not shown while the image is already fitted

  @H1
  Scenario: The fitted image keeps fitting when the window shrinks
    When the workspace window is resized smaller
    Then the image still fits the pane
    When the workspace window is restored to its original size
    Then the image still fits the pane

  @H1
  Scenario: A zoomed-in image is refitted when the window shrinks
    Given the image is zoomed in
    When the workspace window is resized smaller
    Then the image still fits the pane
    When the workspace window is restored to its original size
    Then the image still fits the pane

  @H1
  Scenario: Narrowing a portrait pane refits even when the fitted dimensions are unchanged
    Given a height-constrained portrait is shown in Focus
    And the image is zoomed in
    When the window narrows without changing the portrait fitted size
    Then the image still fits the pane
    When the workspace window is restored to its original size
    Then the image still fits the pane

  @H1
  Scenario: The fullscreen fitted image follows smaller and restored windows
    When the image is opened fullscreen
    And the workspace window is resized smaller
    Then the image still fits the pane
    When the workspace window is restored to its original size
    Then the image still fits the pane

  @H1
  Scenario: A zoomed fullscreen image refits on smaller and restored windows
    When the image is opened fullscreen
    And the fullscreen image is zoomed in
    And the workspace window is resized smaller
    Then the image still fits the pane
    When the workspace window is restored to its original size
    Then the image still fits the pane

  @H1
  Scenario: Fullscreen gives a larger canvas and a deeper zoom
    When the image is opened fullscreen
    Then it fills the window over a dimmed background
    And it can be enlarged up to ten times its fitted size there
    And pressing Escape or using the close control returns to the workspace
    # Corrected against the app: a click on the dimmed area does NOT dismiss it.
    # The zoom surface is stretched to the full pane, so a backdrop click never
    # reaches the element that carries the dismiss handler. See CORRECTIONS.md.

  @H1
  Scenario: Fullscreen Escape still closes after the top bar receives focus
    When the image is opened fullscreen
    And the fullscreen top bar is clicked
    When Escape is pressed in the fullscreen viewer
    Then the fullscreen viewer is closed

  @H1 @H1-5
  Scenario: Moving to another image starts it fitted to the pane
    Given the current image is zoomed in and panned
    When another image is opened
    Then the new image is shown fitted to the pane
    And no zoom or pan state carries over from the previous image

  @H1 @H1-6
  Scenario: Zoom and pan behave the same on portrait, landscape and panorama images
    Given the upload holds a portrait, a landscape and a panorama image of differing sizes
    When each of them is examined closely in the Focus view
    Then each opens whole and undistorted at the fitted size
    And each can be enlarged up to six times its fitted size
    And each can be dragged around once enlarged without moving beyond its edges
    And the portrait and the panorama stay in view when enlarged fullscreen too

  @H1
  Scenario: The focused image is prioritized without a Focus filmstrip
    Given Overview thumbnail downloads are delayed
    Then the Focus image is requested at high priority
    And no Overview thumbnails are requested while Focus is open
    And the Focus image is the only media requested at high priority

  Scenario: Returning to an image shows its loader until it is ready
    Given the current Focus image's next download is delayed
    When another image is opened and the first image is opened again
    Then the Focus loading status stays visible until that image loads

  Scenario: A video loader waits for its first displayable frame
    Given the focused video is waiting for its first frame
    When video metadata becomes available before its first frame
    Then the Focus loading status is still visible
    When the first video frame becomes available
    Then the Focus loading status disappears

  @H1
  Scenario: A failed thumbnail download remains visibly failed
    Given a thumbnail download fails after signing
    Then the failed thumbnail is marked as failed rather than loaded

  @H1
  Scenario: A video thumbnail waits for its first displayable frame
    Given a video thumbnail is waiting for its first frame
    When thumbnail video metadata becomes available before its first frame
    Then the thumbnail play marker is still hidden
    When the thumbnail video frame becomes available
    Then the thumbnail play marker is visible

  @H1
  Scenario: Only the images on screen are rendered while scrolling a large upload
    Given an upload with thousands of images is open
    When the Overview is scrolled
    Then only the rows currently in view are rendered
    And the keyboard-focused image is scrolled into view as focus moves
    # The responsiveness criterion of H1 is addressed by this virtualization
    # plus per-image subscriptions; it is not itself measured by the app.

  @H1 @manual
  Scenario: A thumbnail that cannot be fetched is reported rather than left blank
    Given an image's download link cannot be produced
    Then its tile shows a failure marker in place of the picture
    And the rest of the strip continues to render
    # @manual: not drivable headlessly. The "download link" is a presigned URL
    # computed locally (SigV4 signing over the connected config) — it never
    # touches the network, so no route mock, offline mode or storage state can
    # make it fail. The failure branch is only reachable by corrupting the
    # in-memory config, which no user action does. Verify by code reading or by
    # temporarily forcing `presignImage` to throw.

  @H1
  Scenario: Video media plays instead of zooming
    Given the focused item is a video clip
    Then it plays with the browser's own playback controls
    And the zoom, pan and fullscreen controls are not offered for it
    And moving to another item does not carry over the previous clip's playback position

  @H1
  Scenario: Display can be adjusted to read a dark or washed-out frame
    Given the focused item is a still image
    When the adjustment panel is opened
    Then brightness, contrast, hue and saturation can each be moved across their range
    And the displayed image changes to match
    And a marker shows that the adjustments are no longer neutral

  @unmapped
  Scenario: Adjustment controls avoid covering the focused image
    Given the focused item is a still image
    When the adjustment panel is opened
    Then the adjustment panel leaves the Focus navigation usable
    And it stays in the viewport when neither side fits

  @unmapped
  Scenario: Adjustment controls stay off the image on a phone
    Given the focused item is a still image
    When the adjustment panel is opened on a phone-sized screen
    Then the adjustment panel stays inside the window on a phone

  @unmapped
  Scenario: The Adjust control sits under the zoom column on a wide screen
    Given the focused item is a still image
    Then the Adjust control sits under the zoom button column, with a gap

  @unmapped
  Scenario: The Adjust control stays top-left on a phone
    Given the focused item is a still image
    When the viewport is narrowed to a phone size
    Then the Adjust control sits at the top-left, clear of the zoom column

  @unmapped
  Scenario: Adjust remains below the zoom column while Reset is shown
    Given the focused item is a still image
    And the image is zoomed in
    Then a "Reset" control is offered
    And the Adjust control sits under the zoom button column, with a gap

  @unmapped
  Scenario: Adjust retains its popup and focus while crossing responsive placements
    Given the focused item is a still image
    When the open Adjust panel crosses the desktop breakpoint in both directions
    Then Escape closes the adjustment panel and returns focus to Adjust

  @H1
  Scenario: Adjustment controls follow the focused image
    Given the focused item is a still image
    When the adjustment panel is opened
    And the focused image moves while the adjustment panel is open
    Then the adjustment panel follows the focused image

  @H1
  Scenario: Adjustment controls dismiss when attention moves away
    Given the focused item is a still image
    When the adjustment panel is opened
    Then clicking outside the adjustment panel dismisses it
    And focusing another control dismisses it

  @H1
  Scenario: Adjustment controls work from the keyboard
    Given the focused item is a still image
    When the adjustment panel is opened
    Then keyboard focus enters the adjustment panel
    And Tab wraps between the Focus viewer and the adjustment panel
    And Escape closes the adjustment panel and returns focus to Adjust

  @H1
  Scenario: Display adjustments never change the stored image
    Given the display adjustments have been changed
    Then the stored image, its identifications and its capture time are unaffected
    And the adjustments can be reset to neutral in one action

  @H1
  Scenario: Display adjustments reset by default on the next image
    Given the display adjustments have been changed in the Focus view
    When another image is opened in the Focus view
    Then the adjustments have reset to neutral

  @H1
  Scenario: "Keep values" carries adjustments across images until Focus closes
    Given "Keep values" is checked
    And the display adjustments have been changed in the Focus view
    When another image is opened in the Focus view
    Then the same adjustments still apply
    And leaving the Focus view returns the adjustments to neutral

  @unmapped
  Scenario: "Keep values" is unchecked by default
    When the adjustment panel is opened
    Then the Keep values checkbox is unchecked

  @H1
  Scenario: Previous-image navigation resets adjustments by default
    Given a later image is open for testing previous-image adjustments
    And the display adjustments have been changed in the Focus view
    When the previous image is opened in the Focus view
    Then the adjustments have reset to neutral

  @H1
  Scenario: Keep values also preserves adjustments on previous-image navigation
    Given a later image is open for testing previous-image adjustments
    And "Keep values" is checked
    And the display adjustments have been changed in the Focus view
    When the previous image is opened in the Focus view
    Then the same adjustments still apply

  @H1
  Scenario: Turning Keep values off preserves current values until navigation
    Given "Keep values" is checked
    And the display adjustments have been changed in the Focus view
    When Keep values is turned off without navigating
    Then the current adjustment values are preserved with Keep values off
    When another image is opened in the Focus view
    Then the adjustments have reset to neutral

  @unmapped
  Scenario Outline: Keep values leaves species and navigation shortcuts available
    Given auto-advance is disabled for adjustment shortcut checks
    And an image is shown in the Focus view
    Then Keep values supports <activation> toggling without blocking workspace shortcuts

    Examples:
      | activation |
      | pointer    |
      | keyboard   |
