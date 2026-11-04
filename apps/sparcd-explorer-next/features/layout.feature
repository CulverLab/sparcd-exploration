Feature: The calm layout

  The main page is the top bar, four figures, the map and the tables. What
  left the screen has one place it went: the title menu, the Map menu, the
  View menu, a filter's picker, or the Charts tab. Every menu opens, moves and
  closes from the keyboard, and gives the focus back. Nothing moves when a
  filter changes.

  Scenario: The title menu holds each collection, Change collections, the data checks and when it was updated
    Given I am signed in
    And I open "Alpha Basin" and "Bravo Flats" together
    When I open the title menu
    Then the title menu lists "Alpha Basin" with "11 photos · 5 locations"
    And the title menu lists "Bravo Flats" with "3 photos · 2 locations"
    And the title menu has the entries "Change collections, 5 data checks"
    And the title menu says "Updated just now"
    And the title menu offers "Check for new uploads"
    When I press "5 data checks" in the title menu
    Then Data checks shows 5 problems

  Scenario: With one collection open the title menu leaves out By collection
    Given I have opened "Alpha Basin"
    When I open the title menu
    Then the title menu has no "By collection"
    And the title menu has the entries "Change collection, 4 data checks"

  Scenario: The title menu works from the keyboard and gives the focus back
    Given I am signed in
    And I open "Alpha Basin" and "Bravo Flats" together
    When I move to the collection title and press "Enter"
    Then the focus is on "Alpha Basin"
    When I press the "ArrowDown" key
    Then the focus is on "Bravo Flats"
    When I press the "ArrowDown" key
    Then the focus is on "Change collections"
    When I press the "End" key
    Then the focus is on "Check for new uploads"
    When I press the "ArrowDown" key
    Then the focus is on "Alpha Basin"
    When I press the "Escape" key
    Then no menu is open
    And the focus is on the collection title

  Scenario: The data checks open from the title menu and give the focus back to the title
    Given I have opened "Alpha Basin"
    When I open Data checks
    And I press the "Escape" key
    Then no menu is open
    And the focus is on the collection title

  Scenario: The Map menu holds Hexes or Sites and the basemap, and the map keeps only small controls
    Given I have opened "Alpha Basin"
    When I sign in to the server that shows exact sites and open "Alpha Basin"
    And I open the Map menu
    Then "Hexes" is the choice in "Map shows"
    And "USGS Topo" is the choice in "Basemap"
    When I choose "Sites" in "Map shows"
    Then "Sites" is the choice in "Map shows"
    And the map shows sites
    And the map's only buttons are "Zoom in, Zoom out, Select area, Map"
    And the page says nothing of "See these photos"
    And the page says nothing of "have no location"

  Scenario: The Map menu works from the keyboard and gives the focus back
    Given I have opened "Alpha Basin"
    When I move to the Map button and press "Enter"
    Then the focus is on "USGS Topo"
    When I press the "ArrowDown" key
    Then "Esri Imagery" is the choice in "Basemap"
    And the focus is on "Esri Imagery"
    When I press the "Escape" key
    Then no menu is open
    And the focus is on the Map button

  Scenario Outline: The View menu on <view> holds Columns…, each location ID separately and Export CSV
    Given I have opened "Alpha Basin"
    When I show the <view> table
    And I open the View menu
    Then the View menu has the entries "Columns…, Export CSV"
    And the View menu has the switch "Show each location ID separately"
    And the View menu has no "Show as"

    Examples:
      | view      |
      | Locations |
      | Species   |

  Scenario: The View menu on Photos also holds Grid or List and the sort
    Given I have opened "Alpha Basin"
    When I show the Photos grid
    Then the Tagged control sits in the tab row
    When I open the View menu
    Then the View menu has the entries "Columns…, Export CSV"
    And "Columns…" is disabled
    And the View menu has no switch
    And the View menu has "Show as" and "Order"
    When I press "List" in the View menu
    Then "Columns…" is enabled
    And the View menu has no "Order"

  Scenario: Each table starts with about five columns, and every other column waits under Columns…
    Given I have opened "Alpha Basin"
    Then the columns read "Location, Location ID, Photos, Detections, Active days"
    When I show the Species table
    Then the columns read "Common name, Scientific name, Detections, Animals counted, Locations"
    When I show the Photos table
    Then the columns read "Date and time, Species, Count, Location"
    When I open the Columns editor
    And I show the "Upload" column
    Then the columns read "Date and time, Species, Count, Location, Upload"

  Scenario: The Charts tab has no View menu; Columns… hands the focus back to View
    Given I have opened "Alpha Basin"
    When I move to the View button and press "Enter"
    Then the focus is on "Columns…"
    When I press "Enter" on the focused control
    Then the focus is in the Columns editor
    When I press the "Escape" key
    Then no menu is open
    And the focus is on the View button
    When I show the Charts
    Then the table's controls offer no "View"

  Scenario: The main page has no effort strip; it sits at the top of the Charts tab and sets Dates there
    Given I have opened "Alpha Basin"
    Then there is no effort strip
    When I show the Charts
    Then the strip is the first thing in the Charts
    When I click "Jan 2024" on the strip
    Then the dates filter reads "Dates: Jan 2024"
    When I show the Locations table
    Then the dates filter reads "Dates: Jan 2024"
    And there is no effort strip

  Scenario: Year buttons live in the Dates picker, not in the sidebar
    Given I have opened "Alpha Basin"
    Then the sidebar has no year buttons
    When I press the year 2024 in the dates picker
    Then the dates filter reads "Dates: 2024"
    And the year 2024 is pressed in the dates picker

  Scenario: The Photo files switch lives in its picker
    Given "Alpha Basin" has an upload listing 2 photos whose files aren't on the server
    And I have opened "Alpha Basin"
    And the photo files have been checked
    Then the sidebar has no Photo files switch
    And the files section reads "2 missing files, left out"
    When I open the files filter
    Then "Hide missing files" is the choice in "Photos whose files are missing"
    When I choose "Show missing files" in "Photos whose files are missing"
    Then the files section reads "2 missing files, included"
    And the photo count reads "13 photos"
    When I choose "Only missing files" in "Photos whose files are missing"
    Then the files filter reads "Files: Only the 2 missing files"
    And the photo count reads "2 of 13 photos"

  Scenario: The sidebar's rows run in order, with a quiet More above the last three
    Given "Alpha Basin" has an upload listing 2 photos whose files aren't on the server
    And I am signed in
    And I open "Alpha Basin" and "Bravo Flats" together
    And the photo files have been checked
    Then the sidebar reads "Collections, Species, Locations, Dates, Map area, More, Mountain range, Elevation, Photo files"

  Scenario Outline: Nothing moves when a filter changes at <width> by <height>, the sidebar shown, with <collections> collections
    Given the screen is <width> pixels wide and <height> high
    And there are 7 more collections of 10 photos each
    And I am signed in
    And I have opened <collections> collections
    When I note where everything on the page is
    And I filter species to "Bobcat"
    And I press Escape
    Then nothing on the page has moved
    When I clear the Species filter with its ×
    Then nothing on the page has moved
    When I press the year 2024 in the dates picker
    And I press Escape
    Then nothing on the page has moved
    When I press "Reset filters"
    Then nothing on the page has moved

    Examples:
      | width | height | collections |
      | 1440  | 900    | 2           |
      | 1440  | 900    | 10          |
      | 1280  | 720    | 2           |
      | 1280  | 720    | 10          |

  Scenario Outline: Nothing moves when a filter changes at <width> by <height>, the sidebar hidden, with <collections> collections
    Given the screen is <width> pixels wide and <height> high
    And there are 7 more collections of 10 photos each
    And I am signed in
    And I have opened <collections> collections
    And I hide the sidebar
    When I note where everything on the page is
    And I click the hex holding "AB02"
    Then nothing on the page has moved
    When I press "Reset filters"
    Then nothing on the page has moved
    When I pick "Alpha Basin" in By collection
    And I press Escape
    Then nothing on the page has moved

    Examples:
      | width | height | collections |
      | 1440  | 900    | 2           |
      | 1440  | 900    | 10          |
      | 1280  | 720    | 2           |
      | 1280  | 720    | 10          |

  Scenario Outline: The Locations count stays on the tabs' line at <width> pixels
    Given I have opened "Alpha Basin"
    And the screen is <width> pixels wide
    When I filter species to "Coyote"
    And I press Escape
    Then the table's count reads "5 locations, 1 with matching photos"
    And the tab row is one line

    Examples:
      | width |
      | 1201  |
      | 1280  |
      | 1330  |

  Scenario: The tab row leaves the top of the tables in view at the foot of the first screen
    Given the screen is 1440 pixels wide and 900 high
    And I have opened "Alpha Basin"
    Then the tab row peeks at the bottom of the first screen
    And the first screen has no horizontal overflow

  Scenario: On a map too wide for hex seams, each hex keeps an outline in the accent colour
    Given there are 7 more collections of 10 photos each
    And I am signed in
    And I have opened 10 collections
    Then every hex with photos is outlined in the accent colour

  Scenario: Pressing a tab at the foot of the first screen brings the tables up
    Given the screen is 1440 pixels wide and 900 high
    And I have opened "Alpha Basin"
    When I show the Charts
    Then the tab row sits just under the top bar

  Scenario: On a phone Report and Display sit above the figures, with nothing overflowing
    Given the screen is 390 pixels wide and 844 high
    And I have opened "Alpha Basin"
    Then the row above the figures has "Report & export, Display settings"
    And the first screen has no horizontal overflow
    When I open the title menu
    Then the title menu has the entries "Change collection, 4 data checks"
    And the first screen has no horizontal overflow
