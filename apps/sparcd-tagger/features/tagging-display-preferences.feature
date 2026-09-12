# DRAFT — for review, not yet agreed. Generated 2026-09-11 from apps/sparcd-tagger (src/sections/Settings.tsx, src/lib/formatting.ts, src/components/PerImageTime.tsx, src/components/Overview.tsx, src/components/TimeShiftModal.tsx, src/components/BulkTimeShiftModal.tsx, src/store.ts).

@unmapped
Feature: Choose how dates, times and distances are displayed

  """
  Date and time styles use the browser's language and regional conventions.
  They, together with distance units, are saved in this browser and never alter
  the ISO timestamps stored in media.csv.
  """

  Background:
    Given an upload is open in the tagging workspace

  @unmapped
  Scenario: Dates and times use the required defaults
    When Settings is opened
    Then the date format defaults to ISO local date
    And the time format defaults to 24-hour

  @unmapped
  Scenario: Switching the date format changes every displayed timestamp
    Given the date format is switched to Numeric date in Settings
    And an image is focused
    When the enlarged Focus view is opened
    Then the focused image's corrected time is shown in that date order
    When the detailed Overview list is opened
    Then the Overview list shows capture times in that date order

  @unmapped
  Scenario: Switching the time format changes every displayed timestamp
    Given the time format is switched to 12-hour in Settings
    And an image is focused
    When the enlarged Focus view is opened
    Then the focused image's corrected time carries an AM/PM marker

  @unmapped
  Scenario: Switching the time format changes the whole-upload shift preview
    Given the time format is switched to 12-hour in Settings
    When the time-shift dialog is opened
    Then the shift preview shows times with an AM/PM marker

  @unmapped
  Scenario: Switching the time format changes burst band time spans
    Given burst grouping is switched on in Settings
    And the time format is switched to 12-hour in Settings
    Then burst bands show their time span with an AM/PM marker

  @unmapped
  Scenario: Display preferences persist after a browser reload
    Given the date format is switched to Month Day Short Year in Settings
    And the time format is switched to 12-hour with seconds in Settings
    And distance units are switched to feet in Settings
    When the browser is reloaded
    And Settings is opened
    Then the selected display preferences are retained

  @unmapped
  Scenario: A distance-units choice is offered ahead of a location display
    When Settings is opened
    Then a choice of meters or feet is offered for distance units
    # Not consumed anywhere yet — no location/elevation display exists in the
    # tagger. This sets the unit ahead of that future feature.
