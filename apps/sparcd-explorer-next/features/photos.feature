Feature: Photos grid and detail

  The Photos view shows the photos in view as thumbnails or as a list, in
  the same order and under the same Tagged / Untagged / All switch. A photo
  opens over the page with everything known about it.

  Scenario: The grid shows each photo's own thumbnail, read from the start of the file
    Given I have opened "Alpha Basin"
    When I show the Photos grid
    Then the grid shows 11 photos
    And every tile shows its own embedded thumbnail
    And each thumbnail came from a ranged read of the first 66,000 bytes
    And the tile taken at "2023-04-02 22:40:00" reads "Bobcat, Deer (Mule)" at "AB01"

  Scenario: The Tagged switch applies to the grid, and Grid and List show the same photos
    Given I have opened "Alpha Basin"
    When I show the Photos grid
    And I choose "Untagged" in the Photos switch
    Then the grid shows 4 photos
    And every tile reads "Untagged"
    When I choose "Tagged" in the Photos switch
    Then the grid shows 7 photos
    When I show the Photos table
    Then the Photos table has 7 rows

  Scenario: Only the photos on or near the screen are read
    Given a collection "Echo Wash" with 400 photos
    And I have opened "Echo Wash"
    When I show the Photos grid
    Then the first tile shows its embedded thumbnail
    And fewer than 80 of the 400 photos have been read
    When I scroll to the end of the grid
    Then the last tile shows its embedded thumbnail
    And fewer than 200 of the 400 photos have been read

  Scenario: The table's controls stay in reach while a long table scrolls
    Given a collection "Echo Wash" with 400 photos
    And I have opened "Echo Wash"
    When I show the Photos table
    And I note the height of the table's controls
    And I scroll far down the table
    Then the table's controls sit just under the filter bar, on one line
    And the table's column headers sit just under the table's controls
    When I note where the table's controls are
    And I show the Photos grid
    Then the table's controls have not moved
    And the first tile shows its embedded thumbnail

  Scenario: Each tile keeps its own thumbnail when answers arrive out of order
    Given a collection "Echo Wash" with 400 photos
    And some thumbnails are slow to arrive
    And I have opened "Echo Wash"
    When I show the Photos grid
    And I scroll quickly down the grid and partway back
    Then every tile on screen shows its own thumbnail

  Scenario: A video's first frame loads only once its tile is on screen
    Given a collection "Echo Wash" with 400 photos and a video at the end
    And I have opened "Echo Wash"
    When I show the Photos grid
    Then the first tile shows its embedded thumbnail
    And the video file was never read
    When I scroll to the end of the grid
    Then the last tile shows the video's first frame

  Scenario: A photo without an embedded thumbnail shows the original
    Given I have opened "Charlie Pond"
    When I show the Photos grid
    Then the tile taken at "2025-01-20 09:00:00" shows its embedded thumbnail
    And the tile taken at "2025-01-21 10:00:00" shows the original photo
    When I open the photo taken at "2025-01-21 10:00:00"
    Then the panel shows the original, read once in full

  Scenario: A server that refuses ranged reads still shows every photo
    Given the server refuses ranged reads
    And I have opened "Charlie Pond"
    When I show the Photos grid
    Then the tile taken at "2025-01-20 09:00:00" shows the original photo
    And the tile taken at "2025-01-21 10:00:00" shows the original photo
    And the tile taken at "2025-01-22 11:00:00" is a plain video tile with a play badge

  Scenario: A video shows its first frame with a play badge and plays in the panel
    Given I have opened "Charlie Pond"
    When I show the Photos grid
    Then the tile taken at "2025-01-22 11:00:00" shows the video's first frame with a play badge
    When I open the photo taken at "2025-01-22 11:00:00"
    Then the panel plays the video "CLIP2003.WEBM"

  @US-033 @US-001
  Scenario: A photo opens over the page with all its details, and the arrow keys step through
    Given I have opened "Alpha Basin"
    When I show the Photos grid
    And the originals are slow to arrive
    And I note where the page is
    And I open the photo taken at "2023-04-02 22:40:00"
    Then the panel is titled "Bobcat, Deer (Mule)" with "Lynx rufus, Odocoileus hemionus"
    And the panel shows the thumbnail while the original loads
    And the panel reads "Date and time" "2023-04-02 22:40:00"
    And the panel reads "Count" "1 Bobcat, 2 Deer (Mule)"
    And the panel reads "Location" "Willow Seep"
    And the panel reads "Location ID" "AB01"
    And the panel reads "Collection" "Alpha Basin"
    And the panel reads "Coordinates" "0.512, -150.123"
    And the panel reads "Elevation" "1,200 m"
    And the panel reads "Upload" "2023.05.01.10.00.00_fielduser · fielduser"
    And the panel reads "File name" "IMG0002.JPG"
    And the panel says "10 of 11"
    And the original replaces the thumbnail
    And "Open full size" opens the original in a new tab
    And the page has not moved
    When I press the "ArrowRight" key
    Then the panel says "11 of 11"
    And the panel reads "Date and time" "2023-04-02 06:10:00"
    When I press the "ArrowLeft" key
    And I press the "ArrowLeft" key
    Then the panel reads "Date and time" "2023-04-03 12:00:00"
    And the panel is titled "Untagged" with "Not tagged yet"
    When I press Escape
    Then the photo panel is closed
    And focus is back on the tile taken at "2023-04-02 22:40:00"
    And the page has not moved

  Scenario: A row in the List opens the same panel, in the List's order
    Given I have opened "Alpha Basin"
    When I show the Photos table
    And I sort by "Date and time"
    And I open the row taken at "2024-01-10 05:00:00" from the keyboard
    Then the panel is titled "Coyote" with "Canis latrans"
    And the panel says "4 of 11"
    When I press the "ArrowRight" key
    Then the panel reads "Date and time" "2024-01-11 05:30:00"
    When I press "Close"
    Then the photo panel is closed
    And focus is back on the "View" button of the row taken at "2024-01-10 05:00:00"
