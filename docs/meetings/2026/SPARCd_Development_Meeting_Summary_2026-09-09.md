# SPARCd Development Meeting Summary

**Date:** September 9, 2026  
**Source:** Zoom AI meeting summary and team whiteboard notes

## Meeting focus

The meeting focused on preventing duplicate image storage, revising the object-storage file structure, and preparing the transition from MinIO to Jetstream. The team also reviewed image timestamps and download naming, security and access controls, the Admin and Explorer applications, user-story priorities, and supporting project documentation.

## Key decisions and working direction

- Move forward with a **hash-based storage structure** to prevent duplicate image files.
- Use a **single object-storage bucket** for all collections while maintaining permissions and access controls at the collection level.
- Preserve the current upload-based workflow for tagging and analysis even though the underlying storage structure will change.
- Continue planning the migration from **MinIO to Jetstream**.
- Update the CSV format to **version 2.0** as part of the transition.
- Document the proposed structure, trade-offs, migration process, and user-interface implications before implementation is finalized.
- Use team polls when a development decision needs broader input.

## Discussion summary

### Image storage, hashing, and duplication

The team reviewed the current upload-based storage structure and discussed an alternate content-addressable approach using a hash as a unique identifier for each image. A hash-based structure would allow SPARCd to recognize identical image files and avoid storing duplicates.

The proposed direction is to store images in a single bucket and connect them to the appropriate collections through application metadata. Collection-level permissions would continue to control user access. This approach would reduce duplication while allowing images to remain associated with the uploads, collections, and projects needed for tagging and analysis.

The team also discussed the effect of this change on server navigation. Hash-based names and additional storage levels may make the object-storage interface harder to browse and may not preserve a visually chronological order. The application interface should therefore remain simple for users even if the underlying server structure becomes more technical.

### File structure and Jetstream migration

The team discussed collapsing or revising the current file structure as part of the move from MinIO to Jetstream. The final design needs to define:

- How projects, collections, uploads, and images relate to one another
- Where hashes, UUIDs, timestamps, and original filenames are stored
- How duplicate images are identified and handled
- How access controls are applied at the collection level
- How legacy files and metadata will be migrated
- How the Java application will be handled during and after cut-over
- How the updated CSV 2.0 format supports the new structure

Julian G will prepare a design discussion that records the advantages, disadvantages, and implementation implications of the proposed structure. Sample collections should be used for an end-to-end test before the production cut-over.

### Image timestamps, filenames, and downloads

Susan emphasized that downloaded images need to remain in chronological order. Users may need options to download files using:

- Original filenames
- Image timestamps
- Another unique naming format that prevents filename conflicts

The team noted that EXIF timestamps are not always accurate. A 24-hour time format should be used to reduce ambiguity.

The timestamp-editing feature under development includes the ability to:

- Correct image timestamps
- Interpolate timestamps across a sequence
- Mark timestamps as estimated
- Reassign groups of images through batch operations

The current terminology needs to be made more intuitive. For example, **image** should be used instead of **frame** wherever appropriate. The naming approach also needs to preserve useful information from newer cameras that already include timestamps in their filenames.

### User interface and terminology

The Explorer query interface should match the agreed look and feel for SPARCd and remain understandable to users with different levels of technical experience.

A project glossary is needed to define terms consistently, including:

- Project
- Collection
- Upload
- Image
- Site or location
- Active and retired sites

The team also needs to review how species are displayed and selected, including the species dropdown, and clarify how images without usable timestamps should be handled.

### Security and access

The team reviewed collection-level security and the need to maintain appropriate access when files are stored in a shared bucket. Additional questions include how principal investigators are assigned to research-group allocations and whether guidance is needed from Scott Bonar.

A proxy should be placed in front of object storage to evaluate user-agent requests and, if needed, prevent access from the legacy Java application after the transition.

### Project planning and governance

- The Open Collective work is complete and awaiting notice or confirmation.
- User stories have been ranked using the **MoSCoW method** and still need to be uploaded to the project board.
- Team polls should be used to collect input on decisions that affect the broader workflow.
- The Admin application framework and Explorer interface remain active development priorities.

## Action items

### Julian G

- [ ] Write a design discussion describing the proposed file structure, including its advantages, disadvantages, deduplication approach, permissions, and user-interface implications.
- [ ] Generate the Admin application framework.
- [ ] Prepare for the Jetstream cut-over using sample collections, such as Research 1 and Research 2.
- [ ] Complete an end-to-end migration test before production cut-over.
- [ ] Implement a proxy in front of object storage to evaluate user-agent requests and potentially block the Java application.

### Julian P

- [ ] Continue work on the Jetstream architecture.
- [ ] Coordinate file migration and cut-over preparation with Julian G.
- [ ] Help document how object storage, collection permissions, and the new file structure will work together.
- [ ] Move the MinIO-to-Jetstream mirroring process to the SPARCd allocation server. (not sure if this was Julian G or Julian P).

### Chris

- [ ] Continue work on the SPARCd Explorer application and query interface.Meet with Sue on this.
- [ ] Participate in reviewing the Explorer workflow and terminology.

### Susan

- [ ] Add a UI terminology issue, including changing **frame** to **image** where appropriate.
- [ ] Review the Explorer interface and communicate requested changes to Julian G and Chris.
- [ ] Create `glossary.md` defining SPARCd terms, including projects, collections, uploads, images, and sites.
- [ ] Upload the MoSCoW-ranked user stories to the project board.
- [ ] Follow up on principal investigator assignments for research-group allocations and ask Scott Bonar for guidance if needed.
- [ ] Initiate team polls when broader input is needed and participate in existing polls. 

### Team

- [ ] Review Julian G's design discussion and confirm the final file structure and deduplication rules.
- [ ] Confirm collection-level permission behavior within the single-bucket structure.
- [ ] Decide how species will be listed and selected in the interface.
- [ ] Decide how images with missing or unreliable timestamps will be named, displayed, and downloaded.
- [ ] Confirm requirements for legacy data migration and CSV 2.0.
- [ ] Participate in polls for timely feedback

## Items requiring confirmation

- Final structure for hashed image objects and associated metadata
- Rules for duplicate files found in different collections
- Download naming choices and chronological sorting behavior
- Treatment of missing, estimated, or incorrect timestamps
- Legacy Java application access after Jetstream cut-over
- Ownership and timing of the complete legacy-data migration
- Final division of responsibilities between Julian G and Julian P for migration and cut-over

## Supporting materials

This summary incorporates Sue's notes, the Zoom AI meeting notes, and the team whiteboard notes taken during the meeting. The photographs were used to clarify action items, ownership, security questions, MoSCoW user-story work, and the Jetstream migration discussion.
