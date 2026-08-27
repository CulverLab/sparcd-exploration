# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-uploader (src/sections/Settings.tsx, src/components/Chrome.tsx, src/lib/reset.ts, src/lib/db.ts, src/store.ts).

@unmapped
Feature: Settings and the data the uploader keeps on this machine

  """
  As-built flow: the Settings section holds the default uploader identity and
  the disconnect that clears this machine. A SPARC'd tool is often shared on one
  laptop, so logging out has to leave nothing of the previous person behind —
  but it must not silently destroy uploads they have not finished.
  """

  Background:
    Given the uploader is connected

  @unmapped
  Scenario: A default uploader identity can be set once
    When an uploader identity is entered in Settings
    Then the tool shows the key-safe form of it that will appear in upload paths
    And each new batch starts with that identity already filled in on the Assign step

  @unmapped
  Scenario: Disconnecting from Settings clears this machine's upload records
    Given there are no unfinished uploads on this machine
    When "Disconnect / edit" is chosen
    Then the connection is ended
    And this browser's recorded upload sessions, file states and metadata are cleared
    And the tool returns to the connection screen ready for the next person

  @unmapped
  Scenario: Disconnecting is guarded when unfinished uploads exist
    Given there are unfinished uploads recorded on this machine
    When "Disconnect / edit" is chosen
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
