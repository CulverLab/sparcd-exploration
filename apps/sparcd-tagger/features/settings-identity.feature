Feature: Settings and attribution belong to the active login
  Scenario: Settings retains its preferences in the requested order on a narrow screen
    Given the tagger is connected
    When Settings is opened
    Then Settings has the required section order and disconnect guidance
    And the reordered Settings controls remain usable on a phone

  Scenario: Account names initialize identity and custom identity survives reload
    Given the account-name service returns Alice Researcher
    And an upload is open in the tagging workspace
    When Settings is opened
    Then the identity uses the resolved name and preserves a custom name across reload

  Scenario: Clearing custom identity restores the resolved default on blur
    Given the account-name service returns Alice Researcher
    And the tagger is connected
    When Settings is opened
    Then clearing the identity preserves blank input until blur and restores the account name

  Scenario Outline: Lookup failures block attributed changes while navigation remains available
    Given the account-name service fails with "<failure>"
    And an upload is open in the tagging workspace
    Then missing attribution prevents mouse keyboard drag and write actions
    And entering a custom identity enables tagging despite the lookup error
    Examples:
      | failure        |
      | forbidden      |
      | signature      |
      | malformed      |
      | rate           |
      | server         |
      | network        |
      | rate-absence   |
      | server-absence |

  Scenario: Uploader and Tagger share live per-login identity preferences
    Given the account-name service returns Alice Researcher
    And the tagger is connected
    When Settings is opened
    Then the real Uploader Settings and Tagger share edits in both directions

  Scenario: Identity changes do not relabel recorded identifications or reviews at sync
    Given an upload is open in the tagging workspace
    Then actions under successive custom identities retain their attribution after sync

  Scenario: A rejected browser write retains the custom identity and shows a warning
    Given the account-name service returns Alice Researcher
    And the tagger is connected
    When Settings is opened
    Then a rejected identity preference write preserves the typed identity through retry
