# DRAFT — for review, not yet agreed. Generated 2026-08-06 from apps/sparcd-tagger (src/sections/Browse.tsx, src/lib/queries.ts, src/lib/s3.ts, src/lib/species.ts).

@unmapped
Feature: Find the upload that needs tagging

  """
  As-built flow: Browse is the entry point. The rail lists every collection
  the connected credentials can see; choosing one lists its uploads with how
  much of each is already tagged. Opening an upload moves into the tagging
  workspace.
  """

  Background:
    Given the tagger is connected

  @unmapped
  Scenario: Only collections the credentials can read are offered
    When Browse is opened
    Then the rail lists the collections readable with the connected credentials
    And when none are readable it says no collections are visible to these credentials

  @unmapped
  Scenario: Collection IDs are available on hover without changing collection selection
    When Browse is opened
    Then hovering each collection shows its own collection ID
    And the collection ID tooltip stays open while hovered and dismisses with Escape

  @unmapped
  Scenario: Collection IDs are accessible from the keyboard
    When Browse is opened
    Then tabbing through collections shows their IDs without changing their names
    And Escape dismisses the collection tooltip without moving focus
    And activating the focused collection still selects it

  @unmapped
  Scenario: Collection ID tooltips fit narrow and desktop Browse layouts
    When Browse is opened
    Then collection ID tooltips remain fully inside each viewport

  @unmapped
  Scenario: Hovering another collection replaces the focused collection tooltip
    When Browse is opened
    Then only the hovered collection tooltip appears while another collection has focus

  @unmapped
  Scenario: Narrow collection tooltips never block neighboring rows
    When Browse is opened
    Then collection rows remain directly selectable around narrow-screen tooltips

  @unmapped
  Scenario: Desktop collection tooltips do not act as collection buttons
    When Browse is opened
    Then desktop collection tooltips preserve selection until a collection button is activated

  @unmapped
  Scenario: Collections with matching names still expose their own IDs
    Given the collections have matching display names
    Then hovering each matching collection shows its own collection ID

  @unmapped
  Scenario: The collection rail can be narrowed by name or organization
    Given several collections are listed
    When text is typed into the collection filter
    Then only collections whose name or organization contains that text remain
    And a message names the filter text when nothing matches

  @unmapped
  Scenario Outline: Browse omits the species diagnostic footer in every request state
    Given Browse loads species with "<state>" outcome
    Then the collection rail contains no species diagnostic footer
    And collection uploads remain available

    Examples:
      | state   |
      | loading |
      | success |
      | failure |

  @unmapped
  Scenario Outline: A species read failure is explained in Tag and can be retried from the keyboard
    Given Browse loads species with "failure" outcome
    When the affected upload is opened for tagging in "<view>"
    Then the species panel explains a load failure rather than an empty list
    When the species retry still fails
    Then the species panel retains its error and keyboard retry focus
    When the species source recovers and retry is activated from the keyboard
    Then the species list returns and keyboard focus moves to its filter
    And loaded species can still be applied

    Examples:
      | view     |
      | Overview |
      | Focus    |

  @unmapped
  Scenario: Each upload shows its date, uploader, location, size and tagging progress
    Given a collection is selected
    Then each upload row shows the upload date and time
    And it shows the account that made the upload, when the upload's name carries one
    And it shows the deployment location name(s) recorded for that upload
    And it shows the image count and how many of those images already carry a species

  @unmapped
  Scenario: The Location column pairs the location name with its plain site ID
    Given a collection is selected
    Then the upload row shows the location name followed by its site ID

  @unmapped
  Scenario: The Collected column reads the generated upload comment's collected date
    Given an upload's description records a collection date
    Then the upload row shows that date in the Collected column

  @unmapped
  Scenario: A missing or non-standard collected date explains itself on hover and keyboard focus
    Given a collection is selected
    Then the upload row's Collected column shows a dash
    And hovering it explains the date is missing or not in a recognized format
    And the missing collected date is explained on keyboard focus

  @unmapped
  Scenario Outline: Legacy or non-string descriptions do not break Browse
    Given the upload metadata description is "<kind>"
    Then the upload row's Collected column shows a dash
    And the missing collected date is explained on keyboard focus
    And the upload retains its metadata and still opens for tagging

    Examples:
      | kind    |
      | omitted |
      | null    |
      | number  |
      | boolean |
      | array   |
      | object  |

  @unmapped
  Scenario Outline: Impossible calendar dates are unavailable rather than normalized
    Given the upload description contains collected date "<date>"
    Then the upload row's Collected column shows a dash
    And the missing collected date is explained on keyboard focus

    Examples:
      | date       |
      | 2024-02-30 |
      | 2023-02-29 |
      | 2024-04-31 |
      | 02-30-2024 |
      | 02-29-2023 |
      | 13-01-2024 |

  @unmapped
  Scenario: The documented Uploader collected date is normalized
    Given the upload description contains collected date "03-28-2000"
    Then the Collected value is "2000-03-28"

  @unmapped
  Scenario: A real leap date survives appended comments
    Given the upload description contains collected date "2024-02-29"
    Then the Collected value is "2024-02-29"

  @unmapped
  Scenario: Long location names do not hide IDs or other locations
    Given the upload has long names for multiple locations
    Then the full location names and both IDs remain readable at desktop and mobile widths

  @unmapped
  Scenario: Mobile rows label their metadata and explain missing collection dates
    Given a collection is selected
    Then mobile upload rows label their fields and explain unavailable collection dates

  @unmapped
  Scenario: Narrow Browse windows retain the upload column
    Given a collection is selected
    Then a wide Browse shows every column
    And a medium Browse yields sync status to the collection rail but keeps tagging progress and the collected date
    And a compact Browse at an 853px effective viewport keeps Upload and Sync available
    And a narrower desktop Browse hides tagging progress, collected date and sync together
    And wide Browse gives tagging progress usable space
    And mobile Browse keeps tagging progress aligned

  @unmapped
  Scenario: The upload list can be narrowed by a free-text filter
    Given a collection is selected
    When the upload filter searches for an uploader's name
    Then only uploads from that uploader remain
    When the upload filter searches for an upload date
    Then only the upload made on that date remains
    When the upload filter searches for a location name or site ID
    Then uploads recorded at that location remain and uploads without a location are excluded
    When the upload filter searches for text nothing matches
    Then a message names the filter text when no uploads match

  @unmapped
  Scenario: The free-text filter and the tagging-progress tabs compose together
    Given a collection is selected
    When the upload filter searches for text shared by two uploaders
    And the "Done" tab is chosen
    Then only the finished upload among them remains

  @unmapped
  Scenario: A location filter does not hide a row before its summary has loaded
    Given an upload's summary takes time to load
    When the upload filter searches for a location that upload does not have
    Then that upload stays visible until its summary resolves, then is hidden because it does not match

  @unmapped
  Scenario: An upload whose location file cannot be read still lists
    Given an upload has no readable deployment file
    When its row is shown
    Then the row still shows its date, image count and tagging progress
    And the location column is shown as empty rather than the row being hidden

  @unmapped
  Scenario: Uploads can be narrowed to those still needing work
    Given a collection's uploads have been tallied
    When the "In progress" tab is chosen
    Then only uploads with at least one image still lacking a species are listed
    And the "Done" tab lists only uploads where every image already carries a species
    And uploads whose tally has not finished loading appear only under "All"
    And each tab explains its filter on hover and to assistive technology

  @unmapped
  Scenario: The collection header totals the work outstanding
    Given a collection is selected
    Then the header states how many uploads, images and tagged images it holds
    And it states how many images are still to go
    And it indicates while tallies are still being counted

  @unmapped
  Scenario: Each upload shows whether this browser holds unsynced edits for it
    Given local edits were made to an upload in this browser
    Then that upload's row is marked as having unsynced edits
    And its unsynced explanation is available on hover and keyboard focus
    And an upload whose local edits have all been synced is marked as synced
    And its synced explanation is available on hover and keyboard focus
    And an upload never edited on this machine is marked local-only
    And its local-only explanation is available on hover and keyboard focus

  @unmapped
  Scenario: Opening an upload moves into the tagging workspace
    Given a collection's uploads are listed
    When an upload is opened
    Then the tagger switches to the Tag section for that upload
    And the upload's canonical image list and existing identifications are loaded
