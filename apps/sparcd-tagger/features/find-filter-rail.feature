Feature: Find and filter the Overview in an accessible responsive rail
  Background:
    Given an upload is open in the tagging workspace

  Scenario: Find navigates without filtering and clearing preserves image selection
    Then the Find and filter rail starts closed
    When Find is opened with the slash shortcut
    Then Find navigates independently and clearing preserves selection

  Scenario: Reset filter preserves Find while Close clears both
    When Find is opened with the slash shortcut
    Then Reset filter and Close have their distinct clearing behavior

  Scenario: Radio groups combine with text and date and announce empty results
    When Find is opened with the slash shortcut
    Then all filter radio choices retain their combinations and result counts

  Scenario: Docked Escape preserves values and keyboard access to Overview
    When Find is opened with the slash shortcut
    Then docked Escape preserves Find and filters and permits outside focus

  Scenario Outline: Resizing preserves values in grid and list
    When the rail is opened in the "<kind>" Overview
    Then resizing and increased text size preserve rail values without clipping
    Examples:
      | kind |
      | grid |
      | list |

  Scenario: Modal overlay traps focus and ignores outside clicks
    When the image filter is opened in a narrow viewport
    Then the overlay traps focus and only explicit dismissal clears values

  Scenario: Returning from Focus starts closed with the active filter visible
    When Find is opened with the slash shortcut
    Then Focus excludes the rail and returning closes it without clearing values

  Scenario Outline: Overview starts closed after leaving the workspace
    When Find is opened with the slash shortcut
    And the workspace is left for "<destination>" and reopened
    Then the Find and filter rail starts closed
    Examples:
      | destination |
      | Settings    |
      | upload      |

  Scenario: Narrow overlay controls work with touch
    When the image filter is opened in a narrow viewport
    Then the overlay supports touch clearing, resetting, and closing

  Scenario Outline: Other dialogs retain priority during responsive changes
    When the rail is opened in the "grid" Overview
    Then the "<dialog>" dialog keeps priority while resizing and restores the rail at <width> pixels
    Examples:
      | dialog     | width |
      | Sync       | 600   |
      | Sync       | 1440  |
      | Time shift | 600   |
      | Time shift | 1440  |

  Scenario: Escape dismisses the species dialog without clearing the suspended rail
    When the rail is opened in the "grid" Overview
    Then Escape closes only the species dialog after narrowing the window
