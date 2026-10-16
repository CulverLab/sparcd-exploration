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
  Scenario: Distance units control the emphasis in location elevation details
    When Settings is opened
    Then a choice of meters or feet is offered for distance units
    And distance units default to meters
    When the Tag workspace is reopened
    And the change-location dialog is opened
    Then location elevation details emphasize meters
    When the location dialog is cancelled
    And distance units are switched to feet in Settings
    And the change-location dialog is opened
    Then location elevation details emphasize feet
    When the location dialog is cancelled
    And the browser is reloaded
    And the original upload is reopened after reload
    And the change-location dialog is opened
    Then location elevation details emphasize feet
    When the location dialog is cancelled
    And distance units are switched to meters in Settings
    And the change-location dialog is opened
    Then location elevation details emphasize meters
