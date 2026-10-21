# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-uploader (src/sections/Settings.tsx, src/components/Chrome.tsx, src/lib/reset.ts, src/lib/db.ts, src/store.ts).

@unmapped
Feature: Settings and the data the uploader keeps on this machine

  """
  As-built flow: the Settings section holds the default uploader identity and
  the disconnect that ends the shared session and clears local upload records.
  Remembered non-secret connection details remain. Unfinished uploads must not
  be silently destroyed; discarding them requires explicit confirmation.
  """

  Background:
    Given the uploader is connected

  @unmapped
  Scenario: A default uploader identity can be set once
    When an uploader identity is entered in Settings
    Then the tool shows the key-safe form of it that will appear in upload paths
    And each new batch starts with that identity already filled in on the Describe step

  @unmapped
  Scenario: Custom uploader identities follow their connected login
    When Login A saves custom identity "Ada Lovelace" and reloads
    And the Uploader switches to Login B
    Then Login B's identity defaults to the confirmed endpoint fallback
    When Login B saves custom identity "Grace Hopper"
    And the Uploader switches back to Login A
    Then Login A's custom identity is restored
    When the Uploader switches to Login B
    Then Login B's custom identity is restored

  @unmapped
  Scenario: A same-login tab shares the custom identity preference
    When Login A saves custom identity "Ada Lovelace" and reloads
    And a second Uploader tab adopts the same login
    Then the second tab shows Login A's custom identity
    When the second tab changes Login A's identity to "Grace Hopper"
    Then the first tab shows Login A's updated identity

  @unmapped
  Scenario: A blank custom identity remains editable until blur restores the account default
    When the Uploader identity field is cleared
    Then the field remains blank while it is being edited
    When the blank Uploader identity field loses focus
    Then the uploader identity defaults to the Access key after route absence is confirmed

  @unmapped
  Scenario: Disconnecting from Settings clears this machine's upload records
    Given there are no unfinished uploads on this machine
    When Disconnect is chosen after reviewing its security explanation
    Then the connection is ended
    And this browser's recorded upload sessions, file states and metadata are cleared
    And the tool returns to the connection screen ready for the next person
    And remembered non-secret connection details remain with no live session

  @unmapped
  Scenario: Disconnecting is guarded when unfinished uploads exist
    Given there are unfinished uploads recorded on this machine
    When "Disconnect" is chosen
    Then the tool states how many resumable uploads would be lost
    And it offers to review them in History, to cancel, or to discard them and disconnect
    And nothing is cleared unless discarding is explicitly chosen

  @unmapped
  Scenario: Disconnecting from the header ends the session without clearing records
    When the Disconnect button in the header is used
    Then the connection is ended and the in-progress batch is cleared
    And this machine's recorded upload sessions are left in place
    And they are still listed in History after connecting again
    # This is a real difference from the Settings disconnect, which wipes them.
    # It is also the path that has no unfinished-upload guard.

  @unmapped
  Scenario: The connection in use is shown before disconnecting
    Then Settings shows the endpoint and region currently connected to
    And it never shows the secret key

  @unmapped
  Scenario: The light or dark appearance is remembered across the SPARC'd tools
    When the appearance is switched between light and dark
    Then the choice survives a page reload
    And it is kept where the other SPARC'd tools on this machine read it

  @unmapped
  Scenario: Defaults and Advanced are collapsed, independent keyboard disclosures
    When the settings disclosures are exercised
    And expanded settings controls fit on a narrow screen
    Then their preferences survive reopening with both disclosures collapsed

  @unmapped
  Scenario: Blank identity falls back on blur and custom identity survives reload
    When identity is cleared, typed, and left blank
    Then the account default returns on blur
    When an uploader identity is entered in Settings
    And the custom identity is reloaded
    Then the custom identity is preserved

  @unmapped
  Scenario: Restored and shared sessions supply a missing identity
    When the blank identity session is restored and shared
    Then both sessions use the confirmed Access-key fallback
