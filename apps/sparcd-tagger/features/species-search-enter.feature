@H2
Feature: Enter applies the top displayed species search result
  Background:
    Given a species search vocabulary with ranked, fuzzy, and tied matches

  Scenario Outline: Enter follows the displayed ranking in either view and sorting preference
    Given the Enter search workspace uses "<sort>" ordering in "<view>"
    Then searching "<query>" displays "<species>" first and Enter applies it

    Examples:
      | sort         | view     | query  | species                |
      | alphabetical | Overview | rabbit | Oryctolagus cuniculus   |
      | alphabetical | Focus    | rabbit | Oryctolagus cuniculus   |
      | recent-first | Overview | rabbit | Oryctolagus cuniculus   |
      | recent-first | Focus    | rabbit | Oryctolagus cuniculus   |
      | alphabetical | Overview | rabit  | Oryctolagus cuniculus   |
      | alphabetical | Focus    | rabit  | Oryctolagus cuniculus   |
      | recent-first | Overview | rabit  | Oryctolagus cuniculus   |
      | recent-first | Focus    | rabit  | Oryctolagus cuniculus   |
      | alphabetical | Overview | fox    | Vulpes beta            |
      | alphabetical | Focus    | fox    | Vulpes beta            |
      | recent-first | Overview | fox    | Vulpes beta            |
      | recent-first | Focus    | fox    | Vulpes beta            |

  Scenario Outline: Blank filters and no results make no tag changes
    Given the Enter search workspace uses "recent-first" ordering in "<view>"
    Then Enter with a "<query>" species filter leaves all tags unchanged

    Examples:
      | view     | query      |
      | Overview | empty      |
      | Focus    | empty      |
      | Overview | whitespace |
      | Focus    | whitespace |
      | Overview | no results |
      | Focus    | no results |

  Scenario Outline: Enter keeps the add-only action and selection scope
    Given the Enter search workspace uses "alphabetical" ordering in "<view>"
    Then Enter applies the top species to the selection without incrementing existing counts

    Examples:
      | view     |
      | Overview |
      | Focus    |

  Scenario Outline: Enter retains automatic advance
    Given the Enter search workspace uses "alphabetical" ordering in "<view>"
    Then applying the top displayed species with Enter advances focus once

    Examples:
      | view     |
      | Overview |
      | Focus    |

  Scenario Outline: Help dialogs block Enter tagging behind the dialog
    Given the Enter search workspace uses "alphabetical" ordering in "<view>"
    Then the "<dialog>" dialog blocks Enter in the species filter

    Examples:
      | view     | dialog             |
      | Overview | species help       |
      | Focus    | species help       |
      | Overview | keyboard shortcuts |
      | Focus    | keyboard shortcuts |
