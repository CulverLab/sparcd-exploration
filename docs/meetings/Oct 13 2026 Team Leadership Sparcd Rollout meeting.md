# Sparcd 2.0 Pre Rollout Meeting - October 13, 2026

**In Person meeting at Biosciences East Rm. 311**

- Jane Hunter
- Liz Taylor
- Chris Schnaufer
- Susan Malusa

## Quick recap

The meeting focused on reviewing and refining the new Sparcd web-based upload and tagging applications. Susan and the team discussed the user interface, specifically the need to simplify terminology and layout for non-technical users. They agreed to change "inspect" to "verify," "assign" to "describe," and "deployment" to "site ID," and to move advanced settings into a hidden menu. The group also discussed the importance of adding a "date collected" field and a "comments" section, while removing the "target collection" field. They reviewed the upload process, including the ability to tag images locally before uploading and the need for a clearer "resume" function for interrupted uploads. The team also discussed the tagging interface, suggesting a search bar and a way to identify which collections need tagging help. Finally, they touched upon the need for a more intuitive way to manage user permissions and access to sensitive data.

## Next steps

### Susan

- Change the terminology in the uploader app: rename "Inspect" to "Verify", rename "Assign" to "Describe", and adjust the "Tag species first" button to be less confusing and possibly relocate it.
- Add a "Date collected" field to the uploader app.
- Change the "Description" field in the uploader app to "Comments".
- Remove or hide the "Upload concurrency" and "Upload identity" settings from the uploader app, possibly moving them under an "Advanced options" dropdown.
- Improve the error handling and user feedback for failed uploads, including making the "History" alert more prominent or a separate popup.
- Add a search bar to the tagger app to easily find collections needing tagging.
- Investigate and clarify the offline usage scenario for the Spark app, similar to Survey123.
- Remove the "Test" button from the uploader app.
- Ensure the uploader app displays a clear confirmation of the upload details (collection, location, etc.) before the final upload step.
- Investigate the feasibility of linking Survey123 data to the Sparcd system.
- Plan for a tutorial or documentation for the new Sparcd apps, focusing on the big picture for new users.
- Reach out to the Wildlife Society student club about volunteering as taggers.

## Summary

### User Interface Design Discussion

Sparcd 2.0 - Susan presented four main processes including admin functionality, explaining that while users will access a single interface, the backend will handle separate apps to improve efficiency. The team discussed user interface elements including login requirements, upload concurrency settings, and the history feature for tracking uploads. The group decided to hide advanced options like upload concurrency from regular users and make them accessible only through an advanced options toggle, focusing on creating an intuitive experience for less technical users.

### Sparcd App User Experience Review

The group discussed the functionality and user experience of a new app, focusing on its offline capabilities and workflow for tagging and uploading images. Concerns were made about the clarity of the "Tag Species First" option and suggested alternative phrasings to improve intuitiveness for users. Also - we highlighted the need for definitive answers regarding offline use and app functionality, particularly for users in remote areas with limited connectivity. The group considered various use cases, including fieldwork and local image review, and agreed to review and potentially rephrase certain buttons and options to enhance user experience.

### UI/UX Image Upload Improvements

The group discussed UI/UX improvements for an image upload and tagging system, focusing on reorganizing the page layout to make the upload process more intuitive. Possibly proposed moving the tag species functionality to the side to reduce visual clutter on the main upload page, which currently has a clean and beautiful design. The discussion also covered terminology inconsistencies, particularly around the "start over" and "back" buttons, with Jane suggesting more consistent labeling.

### File Upload Interface Improvements

Liz and Jane led a discussion about improving the terminology and user interface for uploading files, focusing on 17,000-18,000 images. The team reviewed and refined various interface elements, including replacing "files" with "folders," changing "import" to "confirm," and adjusting labels for collection and deployment sections. They decided to use clearer descriptors instead of questions and agreed to replace "target collection" with just "collection" and "deployment" with "site ID." The discussion also covered issues with time zone auto-population and the need for better hover descriptions with information icons.

### Photo Metadata Handling Discussion

Chris discussed metadata handling for photo uploads, explaining that while images are not being modified, metadata information resides in CSV files on the server. She clarified that time zone information needs to reflect where the upload is occurring rather than the current device location. The team discussed categorizing metadata functions into deployment, time zone, and description categories, ultimately settling on "describe" as the appropriate term for one of the categories. Chris also addressed the need to display collection IDs for support purposes, though she expressed concern about the current system being limited by old Java versions.

### Java App Data Collection Issues

Susan and Chris discussed the ongoing issues with the old Java app being used despite being deprecated for 3-4 years, which causes data loss when users switch back to it. The team discussed simplifying the data entry process by removing the description field and replacing it with required collection date information, while keeping comments for additional context. They explored connecting this system with Survey 123 to eliminate data duplication and improve data collection efficiency.

### Data Collection Form Modifications

Liz discussed modifications to a data collection form, deciding to add two new controls: date collected and mountain range/site information. She agreed to change the description field to a comment field to address concerns about missing critical data. The team also discussed the potential for adding image count verification, though they noted technical challenges with upload reliability that would need further discussion in a future meeting.

### File Upload Interface Improvements

The group discussed interface improvements for a file upload system, focusing on making the confirmation process simpler by removing unnecessary technical details and adding a dropdown for advanced options. A proposal to add a comment indicator to show when users have added comments and suggested making error messages more prominent with color highlighting or a dedicated pop-up screen. The discussion also included reflections on how data collection methods have evolved over time, from manual processes using floppy disks and Fortran programs to the current online system.

### File Upload Verification Process Updates

Group members discussed issues with file uploads and verification processes in their system. It was explained that when uploads fail, users need to be trained to monitor the history section to check the status of their uploads, as data can be lost if users remove the SD card before the process completes. Chris demonstrated the verification process and noted that the system now includes steps to re-verify interrupted uploads before proceeding with new uploads. She also mentioned that bad images can be handled during the verification step, allowing users to choose whether to proceed with or ignore problematic images.

### Tagging System Interface Improvements

The team discussed improvements to a tagging system, focusing on user interface enhancements and access controls. They identified the need for a search bar functionality and better visibility into which collections need tagging help, with Susan suggesting that collection information and image counts should be more prominently displayed. The discussion also covered access permissions, with agreement that administrators would control who can see specific collections, though the exact implementation details for requesting help with tagging remain to be determined.
