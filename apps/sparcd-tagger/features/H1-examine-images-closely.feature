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
  Scenario: An image can be enlarged well beyond its fit-to-screen size
    When the image is zoomed in
    Then it can be enlarged up to six times its fitted size
    And detail beyond the fitted view becomes legible

  @H1
  Scenario: The enlarged image can be moved around
    Given the image is zoomed in
    When it is dragged
    Then the visible part of the image moves with the drag
    And it cannot be dragged beyond the edges of the image

  @H1
  Scenario: Zoom can be driven without a mouse wheel
    Then on-screen zoom-in and zoom-out controls are available over the image
    And double-clicking the image zooms in a step

  @H1
  Scenario: Returning to the fitted view is one action away once zoomed
    Given the image is zoomed in
    Then a "Reset" control is offered
    And using it returns the image to the fitted view
    And the control is not shown while the image is already fitted

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
  Scenario: Moving to another image starts it fitted to the pane
    Given the current image is zoomed in and panned
    When another image is opened
    Then the new image is shown fitted to the pane
    And no zoom or pan state carries over from the previous image

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

  @H1
  Scenario: Display adjustments never change the stored image
    Given the display adjustments have been changed
    Then the stored image, its identifications and its capture time are unaffected
    And the adjustments can be reset to neutral in one action

  @H1
  Scenario: Display adjustments persist across images within a viewing session
    Given the display adjustments have been changed in the Focus view
    When another image is opened in the Focus view
    Then the same adjustments still apply
    And leaving the Focus view returns the adjustments to neutral
