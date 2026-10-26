Feature: Report and downloads

  Report, in the header, opens a printable report of whatever is in view over
  the page. From there the report prints or saves as a PDF, and the same
  numbers download as a spreadsheet, CSV files or a Camtrap DP package, never
  with coordinates more exact than the page shows.

  @US-033
  Scenario: The report shows what is in view, and each part can be left out
    Given I have opened "Alpha Basin"
    When I filter species to "Bobcat"
    And I open the report
    Then the report is titled "Camera-trap report" for "Alpha Basin"
    And the report's filters read "Species: Bobcat"
    And the report says "Coordinates rounded to 3 decimal places"
    And the report includes "Summary, Map, Camera effort, Species, Locations, Activity by hour, Data checks"
    And the report's Species table lists "Bobcat"
    And the report's map shows hexes
    When I leave out "Map" and "Species"
    Then the report includes "Summary, Camera effort, Locations, Activity by hour, Data checks"
    When I close the report
    And I open the report
    Then the report includes "Summary, Camera effort, Locations, Activity by hour, Data checks"

  @US-031
  Scenario: With two collections open, the report has totals by collection
    Given I am signed in
    When I open "Alpha Basin" and "Bravo Flats" together
    And I open the report
    Then the report is titled "Camera-trap report" for "Alpha Basin + Bravo Flats"
    And the report's filters read "No filters: all photos"
    And the report includes "Summary, Map, Camera effort, Species, Locations, Activity by hour, By collection, Data checks"
    And the report's totals by collection read "Alpha Basin 11 photos" and "Bravo Flats 3 photos"
    And the report's Locations table has a Collection column

  @US-033
  Scenario: Print or save as PDF prints only the report, on white paper
    Given I have opened "Alpha Basin"
    When I switch to the dark appearance
    And I open the report
    And I press "Print or save as PDF"
    Then the browser was asked to print once
    When the page is set up for printing
    Then only the report's pages show, without its buttons
    And the report prints dark ink on white paper
    And the report keeps table rows and charts whole across pages

  @US-034 @US-001
  Scenario: The spreadsheet holds every sheet, with coordinates at the display precision
    Given I have opened "Alpha Basin"
    When I set the precision to 2 decimals
    And I open the report
    And I download the spreadsheet
    Then the file is named like "alpha-basin-<date>-report.xlsx"
    And the spreadsheet has the sheets "Summary, Locations, Species, Photos, Detections"
    And the "Locations" sheet row for "AB02" has latitude "0.53" and longitude "-150.15"
    And the "Summary" sheet reads "Coordinates" "Coordinates rounded to 2 decimal places"
    And the "Photos" sheet has 11 rows
    And no number in the spreadsheet has more than 2 decimals

  @US-034 @US-001
  Scenario: UTM in the spreadsheet is whole metres at the display precision
    Given I have opened "Alpha Basin"
    When I switch the display to UTM
    And I set the precision to 2 decimals
    And I open the report
    And I download the spreadsheet
    Then the "Locations" sheet row for "AB02" has UTM "5N", easting "817000" and northing "59000"

  @US-034 @US-001
  Scenario: The CSV files come zipped, with coordinates at the display precision
    Given I have opened "Alpha Basin"
    When I set the precision to 2 decimals
    And I filter species to "Coyote"
    And I open the report
    And I download "CSV files (.zip)" from More formats
    Then the file is named like "alpha-basin-<date>-csv.zip"
    And the zip holds "locations.csv, species.csv, photos.csv, detections.csv"
    And "locations.csv" in the zip has the row for "AB02" at latitude "0.53" and longitude "-150.15"
    And "detections.csv" in the zip has 1 row

  @US-034 @US-001
  Scenario: The Camtrap DP package holds the photos in view, with coordinates cut to the display precision
    Given I am signed in
    When I open "Alpha Basin" and "Bravo Flats" together
    And I set the precision to 2 decimals
    And I filter species to "Coyote"
    And I open the report
    And I download "Camtrap DP package (.zip)" from More formats
    Then the file is named like "combined-<date>-camtrap-dp.zip"
    And the zip holds "deployments.csv, media.csv, observations.csv, datapackage.json"
    And the package's media.csv lists "IMG0101.JPG, IMG1101.JPG"
    And every deployment in the package sits at 2 decimals or fewer
    And the package's deployment "AB02" sits at latitude "0.530000" and longitude "-150.150000"
    And the package's datapackage.json follows the Camtrap DP profile and says "Coordinates rounded to 2 decimal places"

  @US-034
  Scenario: With "Tagged" picked in Photos, the report and every download hold only tagged photos, newest first as listed
    Given I have opened "Alpha Basin"
    When I show the Photos table
    And I choose "Tagged" in the Photos switch
    And I note the order of the Photos table
    And I open the report
    Then the report's filters read "Tagged photos only"
    When I download the spreadsheet
    Then the "Photos" sheet has 7 rows
    And every row of the "Photos" sheet reads "Yes" under "Tagged"
    And the "Photos" sheet lists the photos in the noted order
    When I download "CSV files (.zip)" from More formats
    Then "photos.csv" in the zip has 7 rows
    And "photos.csv" in the zip lists the photos in the noted order
    When I download "Camtrap DP package (.zip)" from More formats
    Then the package's media.csv lists "IMG0001.JPG, IMG0002.JPG, IMG0101.JPG, IMG0102.JPG, IMG0201.JPG, IMG0401.JPG, IMG0501.JPG"

  @US-034
  Scenario: The report and its spreadsheet list locations in the table's order
    Given I have opened "Alpha Basin"
    When I sort by "Photos"
    And I note the order of the Locations table
    And I open the report
    Then the report's Locations table lists the locations in the noted order
    When I download the spreadsheet
    Then the "Locations" sheet lists the locations in the noted order

  @US-034
  Scenario: A name that a spreadsheet would run as a formula downloads as text
    Given "Alpha Basin" has a camera named "=1+1"
    And I have opened "Alpha Basin"
    When I open the report
    And I download the spreadsheet
    Then the "Locations" sheet row for "AB07" holds "=1+1" as text, not a formula
    And the "Locations" sheet row for "AB02" has latitude "0.53" and longitude "-150.15"
    When I download "CSV files (.zip)" from More formats
    Then "locations.csv" in the zip names "AB07" "'=1+1"
    When I download "Camtrap DP package (.zip)" from More formats
    Then the package's deployment "AB07" is named "'=1+1"

  Scenario: Closing the report puts the page back where it was, and Esc closes it too
    Given I have opened "Alpha Basin"
    When I note where the page is
    And I open the report
    And I scroll the report to its end
    And I press Escape
    Then the report is closed
    And the page has not moved
    And focus is back on the "Report" button
    When I open the report
    And I close the report
    Then the page has not moved
    And focus is back on the "Report" button
