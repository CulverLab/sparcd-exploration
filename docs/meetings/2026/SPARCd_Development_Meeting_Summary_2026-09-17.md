# SPARCd Development Meeting Summary

**Date:** September 17, 2026  
**Participants:** Susan Malusa, Chris Schnaufer, Julian Gonzalez, Julian Pistorius  
**Focus:** Data standards, migration and rollout planning, application performance, communication features, and branding

## Quick Recap

The team reviewed several design and rollout decisions for the web-based SPARCd system. The group agreed to use a 24-hour clock throughout the application and to derive time-zone information from each camera location rather than asking users to enter or adjust it manually. Stored timestamps should follow a consistent standards-based format, while users should see the correct local time for the camera location.

The team also discussed species-name management, permissions, public-computer sessions, in-app communication, image links, and the transition from the legacy Java application. Changes to scientific names will be restricted to administrators. A changed name may behave as though the old species was removed and a new one added, which could reset user hotkeys; this was considered acceptable, although users may need a clear notice when it occurs.

Migration work remains focused on collection permissions, the revised object-storage structure, deduplication, legacy-data updates, and end-to-end testing before production cutover. The group also identified Explorer loading speed as a launch concern and agreed that it should be documented and investigated. Susan reported that the Open Source Collective application is still under review.

## Decisions

### Time and Time Zones

- Display time in **24-hour format** throughout SPARCd.
- Derive the time zone automatically from the camera location.
- Preserve standards-compliant timestamp data in storage while displaying the correct local time associated with the camera site.
- Do not require users to manually change time-zone settings during upload or tagging.
- Update legacy media and observation records so that time-zone information is represented consistently.

### Species Names and Hotkeys

- Only administrators may edit scientific names in the master species list.
- A scientific-name change can be handled as removal of the old entry and addition of the new entry; a separate identity-tracking mechanism is not required for launch.
- User hotkeys associated with the prior entry may disappear after a name change. This is acceptable, but the application should make the effect clear to users.
- The common-name and scientific-name lists need to be reviewed and finalized.

### Permissions and Public Computers

- Sensitive coordinates and location information must remain protected through collection- and role-based permissions.
- Automatic logout for shared or public computers is useful but remains a lower-priority feature because it conflicts with the earlier preference to avoid disruptive session timeouts.

### Migration and Rollout

- Production cutover will occur only after sample-collection testing and a successful end-to-end migration test.
- The rollout plan must address permissions, the new file structure, deduplication, legacy-data conversion, user training, and the retirement of the Java workflow.
- The new uploader format should be clearly distinguishable from legacy Java uploads so that outdated formats are not accepted after cutover.
- A final rollout date will be coordinated by Julian P., Julian G., and Chris after testing results are available.

## Discussion

### In-App Communication

The team discussed whether communication among uploaders, taggers, specialists, and administrators should occur inside SPARCd or continue primarily through email. Possible approaches included a dedicated communication area, comments connected to records or files, and integration with a discussion platform such as Discourse. No design decision was made.

A user story is needed before selecting a tool. It should define:

- Who needs to communicate with whom.
- What information needs to be exchanged.
- Whether communication is tied to an image, observation, collection, or general project question.
- How quickly a response is needed.
- Which roles may create, view, or respond to messages.

The ability to create a unique shareable link to an image or record may support collaboration, but it is a separate requirement from an in-app messaging system.

### Object Storage, Migration, and Legacy Data

The team continued planning the move from MinIO to Jetstream and the revised object-storage structure. Documentation is needed for collection permissions, file organization, and the Greenfield S3 endpoint. The MinIO-to-Jetstream mirroring process should be moved to the Spark allocation server. Sample collections, including **Research 1** and **Research 2**, will be used to prepare for cutover.

Legacy updates will require scripts to:

- Add time-zone information to existing media records.
- Update legacy observation CSV files where the `animal` field is missing.
- Confirm that converted records comply with the new file and metadata structure.

### Uploader Testing

Susan will test a large upload of **12,222 images**. When possible, the same data should be tested against both a clean bucket and MinIO so the team can compare uploader behavior and isolate proxy, cookie, or configuration issues. The test should be performed only after the required collections and locations are configured.

### Explorer Performance and Image Delivery

Slow loading in Explorer remains an issue. The team discussed displaying smaller previews or thumbnails before loading full-resolution images. Options such as progressive loading and alternate preview formats were considered, but no implementation was selected. A GitHub issue will document the problem and support performance testing and optimization.

### Branding and Hosting

Branding work should be tracked in a GitHub issue and include the application name, domain, favicon, and the distinction between SPARCd-branded and white-label deployments. GitHub Pages was discussed as a possible documentation or hosting component. Chris will document requirements for the Greenfield S3 endpoint and white-label applications.

### Project Documentation and Community Visibility

The project needs a shared glossary so terminology is used consistently across requirements, issues, documentation, and the interface. Julian G. will share relevant GitHub issues with the administrator group. Team members were also asked to star the applicable GitHub repositories to improve project visibility while the Open Source Collective application remains under review.

## Action Items

### Chris

- Address the legacy media and observation time-zone work.
- Develop or complete scripts to add time-zone data to legacy media and correct legacy observation CSV files, including the missing `animal` field.
- Document the Greenfield S3 endpoint.
- Document requirements and considerations for white-label SPARCd applications.
- Contribute to rollout-date and production-cutover planning with Julian P. and Julian G.

### Julian G.

- Document object-storage collection permissions and the revised file structure.
- Continue the end-to-end migration test before production cutover.
- Define how the master species list will be represented and managed in the application.
- Create a project glossary.
- Move the MinIO-to-Jetstream mirroring process to the Spark allocation server.
- Share relevant GitHub issues with the administrator group.
- Contribute to rollout-date and production-cutover planning with Julian P. and Chris.

### Julian P.

- Prepare for the Jetstream cutover using the **Research 1** and **Research 2** sample collections.
- Contribute to rollout-date and production-cutover planning with Julian G. and Chris.

### Susan

- Write a user story for in-app communication that identifies the users, purpose, information exchanged, permissions, and timing needs.
- Draft a rollout document covering the transition timeline, training, cutover steps, and retirement of the Java workflow.
- Open a GitHub issue for branding, domain, favicon, and white-label considerations.
- Send the current species list with common and scientific names for review.
- Test an upload of 12,222 images against a clean bucket and MinIO when the required test configuration is ready.
- Forward Reptile/GitHub usage messages to Julian G. and Julian P.

### All

- Create or contribute to a GitHub issue documenting Explorer's slow loading and possible optimization work.
- Star the applicable SPARCd GitHub repositories.

## Open Questions

- Should SPARCd include in-app communication, integrate with an external discussion platform, or continue using email?
- What records should support unique shareable links, and what permissions must those links enforce?
- What idle-time behavior is appropriate on shared or public computers?
- Which thumbnail or progressive-loading approach will provide the best Explorer performance?
- What is the final production rollout date after migration testing is complete?
- How should users be notified when a scientific-name change resets or removes a hotkey?

