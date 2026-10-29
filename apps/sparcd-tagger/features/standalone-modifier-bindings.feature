@H2
Feature: Bind standalone Shift and Control without stealing combinations
  Scenario Outline: Either side tags once on release and Ghost ignores count prefixes
    Given a modifier tagging workspace in "<view>"
    And "<modifier>" is assigned to Ghost with a standalone tap
    Then holding "<side>" "<modifier>" leaves tags unchanged until release and Ghost stays at one
    Examples:
      | view     | modifier | side  |
      | Overview | Shift    | Left  |
      | Overview | Shift    | Right |
      | Focus    | Shift    | Left  |
      | Focus    | Shift    | Right |
      | Overview | Control  | Left  |
      | Overview | Control  | Right |
      | Focus    | Control  | Left  |
      | Focus    | Control  | Right |

  Scenario Outline: Named bindings from the official vocabulary work
    Given the official Ghost binding is "<modifier>"
    And a modifier tagging workspace in "Overview"
    Then the official "<modifier>" binding works from either side
    Examples:
      | modifier |
      | Shift    |
      | Control  |

  Scenario Outline: A local named binding survives reload
    Given a modifier tagging workspace in "Overview"
    And "<modifier>" is assigned to Ghost with a standalone tap
    Then the saved "<modifier>" binding survives reload and tags with the opposite side
    Examples:
      | modifier |
      | Shift    |
      | Control  |

  Scenario Outline: Reassignment uses the existing conflict confirmation and count handling
    Given a modifier tagging workspace in "Overview"
    And "<modifier>" is assigned to Ghost with a standalone tap
    Then reassigning "<modifier>" requires confirmation and retains normal species counts
    Examples:
      | modifier |
      | Shift    |
      | Control  |

  Scenario Outline: Existing combinations keep their normal actions
    Given a modifier tagging workspace in "Overview"
    And "<modifier>" is assigned to Ghost with a standalone tap
    Then "<modifier>" combinations retain existing shortcuts without tagging Ghost
    Examples:
      | modifier |
      | Shift    |
      | Control  |

  Scenario Outline: Inputs and help dialogs never tag from modifier release
    Given a modifier tagging workspace in "<view>"
    And "<modifier>" is assigned to Ghost with a standalone tap
    Then "<modifier>" taps in text entry and help dialogs make no tag changes
    Examples:
      | view     | modifier |
      | Overview | Shift    |
      | Focus    | Shift    |
      | Overview | Control  |
      | Focus    | Control  |

  Scenario Outline: Interrupted gestures are discarded
    Given a modifier tagging workspace in "Overview"
    And "<modifier>" is assigned to Ghost with a standalone tap
    Then a "<interruption>" interrupts "<modifier>" without tagging
    Examples:
      | modifier | interruption |
      | Shift    | pointer      |
      | Control  | pointer      |
      | Shift    | wheel        |
      | Control  | wheel        |
      | Shift    | blur event   |
      | Control  | blur event   |

  Scenario Outline: Modifier bindings work while Adjust controls are focused
    Given a modifier tagging workspace in "Focus"
    And "<modifier>" is assigned to Ghost with a standalone tap
    When the "<control>" Adjust control is focused
    Then a standalone "<modifier>" tap tags Ghost once from the focused "<control>" control
    Examples:
      | modifier | control     |
      | Shift    | brightness |
      | Control  | brightness |
      | Shift    | Keep values |
      | Control  | Keep values |

  Scenario Outline: Selected images and automatic advance retain their scope
    Given a modifier tagging workspace in "<view>"
    And "<modifier>" is assigned to Ghost with a standalone tap
    Then "<modifier>" applies Ghost to the selection once and advances once
    Examples:
      | view     | modifier |
      | Overview | Shift    |
      | Focus    | Shift    |
      | Overview | Control  |
      | Focus    | Control  |

  Scenario Outline: Command shortcuts with suppressed releases do not disable modifier tagging
    Given a modifier tagging workspace in "<view>"
    And "<modifier>" is assigned to Ghost with a standalone tap
    Then "<modifier>" still tags after a Command shortcut with a missing letter release
    Examples:
      | view     | modifier |
      | Overview | Shift    |
      | Focus    | Shift    |
      | Overview | Control  |
      | Focus    | Control  |
