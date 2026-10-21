@unmapped
Feature: Enter Focus from Overview images

  Background:
    Given an upload is open in the tagging workspace

  @unmapped
  Scenario: The Tag workspace starts in Overview without mode buttons
    Given the Overview is shown
    Then the Overview and Focus mode buttons are absent
    And the Grid and List controls are available

  @unmapped
  Scenario Outline: Mouse double-click opens Focus and applies selection once
    Given the Overview is set to the "<layout>" layout
    And IMG003.JPG is "<selection>" in the current selection
    When IMG003.JPG is opened by mouse double-click
    Then Focus shows IMG003.JPG and the selection reflects one plain activation before and after "<dismissal>"

    Examples:
      | layout | selection  | dismissal   |
      | grid   | selected   | Close       |
      | grid   | selected   | Escape      |
      | grid   | selected   | browser Back|
      | grid   | unselected | Close       |
      | grid   | unselected | Escape      |
      | grid   | unselected | browser Back|
      | list   | selected   | Close       |
      | list   | selected   | Escape      |
      | list   | selected   | browser Back|
      | list   | unselected | Close       |
      | list   | unselected | Escape      |
      | list   | unselected | browser Back|

  @unmapped
  Scenario Outline: Touch double-tap opens Focus and applies selection once
    Given the Overview is set to the "<layout>" layout
    And IMG003.JPG is "<selection>" in the current selection
    When IMG003.JPG is opened by touch double-tap
    Then Focus shows IMG003.JPG and the selection reflects one plain activation before and after "<dismissal>"

    Examples:
      | layout | selection  | dismissal   |
      | grid   | selected   | Close       |
      | grid   | selected   | Escape      |
      | grid   | selected   | browser Back|
      | grid   | unselected | Close       |
      | grid   | unselected | Escape      |
      | grid   | unselected | browser Back|
      | list   | selected   | Close       |
      | list   | selected   | Escape      |
      | list   | selected   | browser Back|
      | list   | unselected | Close       |
      | list   | unselected | Escape      |
      | list   | unselected | browser Back|

  @unmapped
  Scenario Outline: One touch tap keeps the existing Overview selection behavior
    Given the Overview is set to the "<layout>" layout
    And IMG003.JPG is "<selection>" in the current selection
    When IMG003.JPG is tapped once by touch
    Then IMG003.JPG is focused in Overview, one plain activation is applied, and Focus stays closed

    Examples:
      | layout | selection  |
      | grid   | selected   |
      | grid   | unselected |
      | list   | selected   |
      | list   | unselected |

  @unmapped
  Scenario Outline: Semantic activation opens Focus without changing selection
    Given the Overview is set to the "<layout>" layout
    And IMG001.JPG and IMG002.JPG are selected
    When IMG001.JPG is activated semantically
    Then Focus shows IMG001.JPG without changing selection through dismissal

    Examples:
      | layout |
      | grid   |
      | list   |

  @unmapped
  Scenario Outline: Native keyboard activation opens the focused image from either layout
    Given the Overview is set to the "<layout>" layout
    When IMG003.JPG receives keyboard focus and "<key>" is pressed
    Then Focus shows IMG003.JPG
    When Focus is closed with Escape
    Then the Overview is shown
    And the image opener has focus again

    Examples:
      | layout | key   |
      | grid   | Enter |
      | grid   | Space |
      | list   | Enter |
      | list   | Space |

  @unmapped
  Scenario Outline: Shift+Space still marks questionable images in Overview
    Given the Overview is set to the "<layout>" layout
    When IMG003.JPG receives keyboard focus and "Shift+Space" is pressed
    Then the Overview remains open and IMG003.JPG is marked questionable
    And its existing species survive marking and sync

    Examples:
      | layout |
      | grid   |
      | list   |

  @unmapped
  Scenario Outline: Quick modified clicks preserve both selection changes
    Given the Overview is set to the "<layout>" layout
    When IMG003.JPG is control-clicked twice
    Then IMG003.JPG is deselected and Focus stays closed

    Examples:
      | layout |
      | grid   |
      | list   |

  @unmapped
  Scenario: Touch movement cancels double-tap entry and leaves scrolling available
    Given the Overview is set to the "list" layout
    When a touch starts on IMG003.JPG and moves before release
    Then the Overview stays open and IMG003.JPG is not opened in Focus

  @unmapped
  Scenario: A long touch does not open Focus
    Given the Overview is set to the "grid" layout
    When IMG003.JPG is held by touch before release
    Then the Overview stays open and IMG003.JPG is not opened in Focus

  @unmapped
  Scenario: Focus return preserves the Overview filter and layout
    Given the Overview is set to the "list" layout
    When the image filter matches IMG003.JPG
    And IMG003.JPG receives keyboard focus and "Enter" is pressed
    Then Focus shows IMG003.JPG
    When Focus is closed with Escape
    Then the Overview is shown
    And the List layout and IMG003.JPG filter remain active

  @unmapped
  Scenario: Focus return restores the Overview scroll position
    Given the Overview is set to the "list" layout
    And the Overview scroll region is short
    When IMG005.JPG is opened by mouse double-click
    Then Focus shows IMG005.JPG
    When Focus is closed with Escape
    Then the Overview scroll position is restored
    And the IMG005.JPG opener has focus again
