# DRAFT — for review, not yet agreed. Generated 2026-09-11 from apps/sparcd-tagger (src/sections/Settings.tsx, src/sections/Tag.tsx, src/store.ts).

@unmapped
Feature: Advance to the next image automatically after tagging

  """
  As-built: an opt-in Settings toggle moves focus to the next image whenever
  a species is newly recorded on the focused image — by panel click, by a
  keyboard shortcut, or by dragging a species tile onto the focused image.
  It never fires for a re-click or keypress that only changes an
  already-recorded species' count, for a multi-image selection, or for a
  drop onto an image other than the one in focus.
  """

  Background:
    Given an upload is open in the tagging workspace
    And the species vocabulary has loaded

  @unmapped
  Scenario: Auto-advance is off by default
    When Settings is opened
    Then auto-advance is unchecked in Settings

  @unmapped
  Scenario: Adding a new species by panel click advances to the next image
    Given auto-advance is switched on in Settings
    And an image is focused
    And the current focus is noted
    When a species not already on that image is applied from the panel
    Then focus moves to the next image in the list

  @unmapped
  Scenario: Re-applying an already-present species does not advance
    Given auto-advance is switched on in Settings
    And the focused image already carries a species
    And the current focus is noted
    When that species is applied again from the panel
    Then focus stays on the same image

  @unmapped
  Scenario: Incrementing an existing species by keystroke does not advance
    Given auto-advance is switched on in Settings
    And the species vocabulary carries a key binding for a species
    And the focused image already carries a species
    And the current focus is noted
    When the bound key is pressed once
    Then focus stays on the same image

  @unmapped
  Scenario: Adding a new species by keystroke advances to the next image
    Given auto-advance is switched on in Settings
    And the species vocabulary carries a key binding for a species
    And an image is focused
    And the current focus is noted
    When the bound key is pressed once
    Then focus moves to the next image in the list

  @unmapped
  Scenario: Applying a species to a multi-image selection never advances
    Given auto-advance is switched on in Settings
    And several images are selected
    And the current focus is noted
    When a species is applied to the selection
    Then focus stays on the same image

  @unmapped
  Scenario: Dropping a new species onto the focused image advances
    Given auto-advance is switched on in Settings
    And an image is focused
    And the current focus is noted
    When a species tile is dragged onto the image area in the Focus view
    Then focus moves to the next image in the list

  @unmapped
  Scenario: Dropping a species onto a different image never advances
    Given auto-advance is switched on in Settings
    And an image is focused
    And the current focus is noted
    When a species tile is dragged onto a different image tile in Overview
    Then focus stays on the same image
