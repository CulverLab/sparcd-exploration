@unmapped
Feature: Classification checkmarks are prominent without blocking images
  Background:
    Given an upload is open in the tagging workspace

  Scenario: Grid tile accessible names identify images and videos
    Then grid image and video tile names include their media type

  Scenario Outline: Checkmarks use the image corners and follow list filenames
    Given the checkmark layout uses width <width> and theme "<theme>"
    Then the classified grid image has a transparent green checkmark one third of its short side
    And badges preserve image selection and double-click opening
    And the Focus checkmark is small and leaves viewer controls usable
    And image-only fullscreen contains no classification checkmark
    And list badges follow the filename in classification and expert order
    Examples:
      | width | theme |
      | 1440  | light |
      | 1440  | dark  |
      | 390   | light |
      | 390   | dark  |

  Scenario: Classifications including Ghost and Test update immediately and survive publication
    Then classification checkmarks follow species edits Ghost Test clearing sync and reload

  Scenario Outline: Letterboxed images keep their checkmarks on the fitted picture
    Given the checkmark image is <width> by <height> at viewport width <viewport>
    Then the Focus checkmark stays inside the fitted image upper left corner
    Examples:
      | width | height | viewport |
      | 600   | 1000   | 1440     |
      | 1200  | 240    | 1440     |
      | 600   | 1000   | 390      |
      | 1200  | 240    | 390      |

  Scenario: Touching a checkmark selects its image and leaves Focus opening available
    Then touch input passes through classification checkmarks
