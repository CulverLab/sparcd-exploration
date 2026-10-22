@unmapped
Feature: Need expert badges show shared image status
  Background:
    Given an upload is open in the tagging workspace

  Scenario Outline: A transparent circled question mark shares the image with its classification badge
    Given expert badges are viewed at width <width> in "<theme>" mode
    Then the expert toggle is available without an inactive badge
    When the expert toggle marks the focused image
    Then a goldenrod circled question mark occupies the upper right of its grid image
    And clicking the expert badge selects and opens the image without toggling it
    And the regular Focus expert badge stays clear of viewer controls
    And the expert badge is absent from image-only fullscreen
    And expert badges follow filenames and classification badges in List
    Examples:
      | width | theme |
      | 1440  | light |
      | 1440  | dark  |
      | 390   | light |
      | 390   | dark  |

  Scenario: Expert-only badges survive a fresh session and disappear after a saved clear
    Then an image without species shares its expert badge through sync fresh session and clearing

  Scenario: A mixed selection updates its badges once from mouse and keyboard
    Then expert badge targeting preserves mixed selection and Shift Space behavior

  Scenario: Expert badges preserve touch selection and Focus opening
    Then touching an expert badge leaves the expert toggle state unchanged

  Scenario Outline: Letterboxed Focus images keep both badges inside their image
    Given the checkmark image is <width> by <height> at viewport width <viewport>
    When the expert toggle marks the focused image
    Then the expert badge stays in the fitted image upper right area
    And the regular Focus expert badge stays clear of viewer controls
    Examples:
      | width | height | viewport |
      | 600   | 1000   | 1440     |
      | 1200  | 240    | 390      |
