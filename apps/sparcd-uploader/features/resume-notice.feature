Feature: Unfinished uploads remain visible before choosing another folder
  Background:
    Given the uploader is connected

  @unmapped
  Scenario Outline: The notice prioritizes actionable uploads and opens History
    Given the resume notice has a <kind> upload
    Then the notice explains the <kind> upload in both themes and phone layouts
    And the notice opens History from the keyboard

    Examples:
      | kind        |
      | failed      |
      | paused      |
      | publication |
      | multiple    |

  @unmapped
  Scenario: No notice is shown when there are no unfinished uploads
    Then there is no unfinished upload notice
