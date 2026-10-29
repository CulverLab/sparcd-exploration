@H3
Feature: Completed collection edits save automatically with one-level Undo
  Background:
    Given an upload with existing identifications is open in the tagging workspace

  Scenario: A species saves without a dialog and can be undone after reload
    When Coyote is applied for automatic saving
    Then the Coyote is saved without manual controls or per-edit snapshots
    When the automatically saved upload is reloaded
    And the latest automatic action is undone
    Then the Coyote addition is reversed and its audit history remains

  Scenario: A later edit is retained while an earlier automatic save is in flight
    When two species edits straddle an automatic save
    Then both species edits reach shared storage

  Scenario: Offline standalone editing is paused and pending work recovers
    When a completed edit loses connectivity before automatic saving
    Then further collection edits and Undo are disabled
    When Retry and the save shortcut are used while offline
    Then further collection edits and Undo are disabled
    When the connection returns
    Then the Coyote is saved without manual controls or per-edit snapshots

  Scenario: A review can be undone without deleting its provenance
    When an existing identification is reviewed and automatically saved
    And the latest automatic action is undone
    Then its review is reversed with the original event and identifier retained

  Scenario: Location Undo restores only the affected capture and deployment values
    When the original canonical values are recorded for Undo verification
    And the change-location dialog is opened
    And a different location is picked and applied
    And the location change finishes automatic saving
    And the latest automatic action is undone
    Then the original location and capture values are restored without replacing audit history

  Scenario: Location Undo also restores an originally absent deployment
    When the original deployment metadata is absent
    And the original canonical values are recorded for Undo verification
    And the change-location dialog is opened
    And a different location is picked and applied
    And the location change finishes automatic saving
    And the latest automatic action is undone
    Then the original location and capture values are restored without replacing audit history

  Scenario Outline: Interrupted location Undo resumes its journal without recompiling reversed values
    When the original canonical values are recorded for Undo verification
    And the change-location dialog is opened
    And a different location is picked and applied
    And the location change finishes automatic saving
    And the location Undo fails after publishing media
    Then pending work and its journal remain available with retry announced
    When the interrupted location Undo is recovered by "<recovery>"
    Then the original location and capture values are restored without replacing audit history
    And the location Undo journal is cleared without repeating media

    Examples:
      | recovery |
      | retry    |
      | reload   |

  Scenario Outline: Pausing collection editing retains an unfinished count
    When an unfinished count is paused by "<pause>"
    Then the unfinished count remains visible with editing disabled
    When editing resumes after "<pause>"
    Then the unfinished count can be finished and saved

    Examples:
      | pause        |
      | connectivity |
      | save failure |

  Scenario: Finished count input saves and incomplete input is not published
    When a count is edited without finishing the field
    Then its unfinished value is not published or presented as Saved
    When the count is finished with the save shortcut
    Then its completed count is saved and can be undone

  Scenario: A refreshed clean draft starts from the other writer's identification
    When Coyote and deer are automatically saved on one image
    And another writer replaces them with bobcat and this client refreshes
    And Puma is added to the refreshed image
    Then bobcat and Puma are stored without resurrecting Coyote or deer

  Scenario: Invalid finished input stays focused and cannot be called Saved
    When an invalid count is submitted with the save shortcut
    Then the invalid count stays focused and shared storage is unchanged

  Scenario: A permission failure retains the complete journal until reload recovery
    When an automatic save fails after publishing observations
    Then pending work and its journal remain available with retry announced
    When the automatically saved upload is reloaded
    Then the Coyote is saved exactly once and its journal is cleared

  Scenario: A failed save can be explicitly discarded to leave the upload
    When an automatic save fails after publishing observations
    Then pending work and its journal remain available with retry announced
    When the failed save is explicitly discarded
    Then discard releases the disconnect guard and clears only this account's recovery

  Scenario: A failed Undo remains retryable after reload
    When Coyote is applied for automatic saving
    And the automatic save completes
    And the Undo fails after publishing its observations
    Then pending work and its journal remain available with retry announced
    When the automatically saved upload is reloaded
    Then the Coyote addition is reversed and its audit history remains

  Scenario: An unrefreshed remote edit offers explicit comparison and discard
    When Coyote is applied for automatic saving
    And the automatic save completes
    And another writer replaces Coyote without refreshing this client
    And Puma is applied against the stale workspace
    Then the conflicting remote edit survives and local work is retained
    When current storage is explicitly chosen
    Then the remote bobcat remains and discarded edits do not return after reload

  Scenario: Reapplying a conflict preserves remote species and gives the reapplied edit Undo
    When Coyote is applied for automatic saving
    And the automatic save completes
    And another writer replaces Coyote without refreshing this client
    And Puma is applied against the stale workspace
    Then the conflicting remote edit survives and local work is retained
    When the pending values are explicitly reapplied
    Then bobcat and Puma are stored without resurrecting Coyote or deer
    When the latest automatic action is undone
    Then only the remote bobcat remains

  Scenario: Discarding a conflict refreshes the stored location and editing time zone
    When Coyote is applied for automatic saving
    And the automatic save completes
    And another writer replaces Coyote without refreshing this client
    And another writer moves the camera to New York without refreshing this client
    And Puma is applied against the stale workspace
    Then the conflicting remote edit survives and local work is retained
    When current storage is explicitly chosen
    Then the refreshed camera location and editing time zone are used without reloading

  Scenario: A remote edit to the affected field prevents Undo
    When Coyote is applied for automatic saving
    And the automatic save completes
    And another writer replaces Coyote without refreshing this client
    And Undo is requested with the keyboard
    Then Undo explains the changed stored data and preserves bobcat

  Scenario: An unrelated remote expert edit survives species Undo
    When Coyote is applied for automatic saving
    And the automatic save completes
    And another writer marks this image as needing an expert
    And Undo is requested with the keyboard
    Then the Coyote addition is reversed and its audit history remains
    And the unrelated remote expert marker remains

  Scenario: Application Redo shortcuts do not consume Undo
    When Coyote is applied for automatic saving
    And the automatic save completes
    And application Redo shortcuts are pressed
    Then the Coyote is still saved and Undo is available

  Scenario: Two browser tabs cannot consume the same Undo twice
    When Coyote is applied for automatic saving
    And the automatic save completes
    And two tabs request the same persisted Undo
    Then the Coyote addition is reversed and its audit history remains

  Scenario: A stale tab retains accepted changes without corrupting the other tab's recovery
    When two tabs edit from different recovery versions
    Then both tabs' accepted actions remain available for explicit review
    When the pending values are explicitly reapplied
    Then Coyote and Puma are stored and the latest action alone can be undone

  Scenario: Reload and reconnect retain a conflict until explicit review
    When Coyote is applied for automatic saving
    And the automatic save completes
    And another writer replaces Coyote without refreshing this client
    And Puma is applied against the stale workspace
    Then the conflicting remote edit survives and local work is retained
    When the conflict is reloaded and connectivity changes
    Then the conflict remains paused with its retained local work
    When current storage is explicitly chosen
    Then the remote bobcat remains and discarded edits do not return after reload

  Scenario: An image removed remotely blocks publication without an endless reconnect loop
    When another writer removes this image from canonical media
    And Puma is applied against the stale workspace
    Then the removed image is reported as a retained conflict
    When current storage is explicitly chosen
    Then the removed image stays absent and its original media object is untouched
