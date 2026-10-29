# SPARCd Development Meeting Summary

## Purpose

This meeting focused on current SPARCd development progress, migration planning, server access, PR review, upload and permissions issues, and near-term coordination for testing and rollout.

## Key Updates

### Development Progress

- Chris is continuing work on uploader and tagger issues, legacy time zone handling, observation legacy work, and the Greenfield S3 endpoint.
- The team agreed to focus first on getting the current core functionality working reliably before moving toward AI-assisted automatic processing.
- Non-draft PRs up to PR 436 are targeted for review and merge by next week.
- Susan will test tagger functionality after the merge work is complete.

### Communication and User Stories

- The team discussed keeping communication features separate from the SPARCd app rather than building an internal communication system.
- A forum-style communication space is preferred, with SPARCd linking to external content when appropriate.
- Any linked content should still respect permission-based access controls.
- Susan will write a user story describing how users should request or communicate information changes outside of the app.

### Migration and Server Access

- Julian P. can access most servers, but Research 1 and Research 2 are not currently responding even though DNS records still exist.
- Susan and Julian P. will screen share using Susan's old laptop to troubleshoot SSH keys and server access.
- Susan will review documentation to determine whether Research 1 and Research 2 were intended to be decommissioned.
- The Sandbox endpoint will be and/or can be used for migration testing.
- Julian P. will provide Susan with wording and the correct address for the DNS email needed for migration pointing.
- Julian P. will complete University of Arizona information security awareness training to obtain VPN access.

### File Architecture and Data Migration

- Susan will work on a translator for the new file architecture so the Java app can continue to function during the transition.
- The team discussed file size reduction and the need to maintain data integrity during migration.
- Communication with Matt is not needed immediately, but will be needed after migration.

### File Formats and Video Handling

- The team discussed current video format limitations.
- The current system converts files to MP4, but the new version may require users to handle some conversions manually.
- This limitation should be documented clearly as part of rollout planning.

### Permissions, Uploads, and S3 Management

- The team discussed the need for an admin feature to move uploads between collections.
- This is also tied to file permissions and S3 object management.
- Renaming or moving objects in S3 should be handled through an admin interface rather than manual backend changes.
- Chris will create an issue for the admin feature and the related permission problem.
- The team still needs to decide whether moving uploads between collections should be limited to admins only.

### BMC and Server Management

- Julian explained the role of BMC, or Baseboard Management Controller, for out-of-band server management.
- BMC would be useful when systems are down, locked out, or being reinstalled.
- The current system relies primarily on SSH and web access.
- The team discussed adding more file access redundancy after migration.

### Existing Implemented Features

- Duplicate hotkey alerts are already implemented.
- User notifications for scientific name changes are already implemented.
- Hotkey management and scientific name change notifications should still be considered in rollout communication.

### Website and Show-and-Tell Coordination

- Susan will coordinate bringing in Liz and Jane for a show-and-tell session next week.
- The show-and-tell is planned for Thursday afternoon before hacky hour, likely from 2-4 PM.
- Susan will try to book a room in the main library, with BSRL as a backup location.
- The team also briefly discussed website leadership updates and correcting a name spelling from "Christopher" to "Christophe."

## Decisions

| Topic | Decision |
| --- | --- |
| Communication tools | Keep communication separate from the SPARCd app and use a forum-style approach. |
| Migration testing | Use the Sandbox endpoint for migration testing. |
| AI processing | Prioritize stable core functionality before implementing AI-assisted automatic processing. |
| Upload movement | Create an admin issue for moving uploads between collections and related permissions. |
| S3 object changes | Handle object movement or renaming through the admin interface. |
| Show-and-tell | Plan a Thursday afternoon session with Liz and Jane next week. |

## Action Items

| Owner | Action Item | Timing |
| --- | --- | --- |
| Chris | Review and merge non-draft PRs up to PR 436. | By next week |
| Chris | Complete time zone legacy and observation legacy work. | In progress |
| Chris | Complete the Greenfield S3 endpoint work. | Target Friday |
| Chris | Add tentative dates to the rollout plan document. | Next update |
| Chris | Continue uploader and tagger issue work and ensure good coverage. | Ongoing |
| Chris | Create an issue for the admin feature to move uploads between collections and address the related permissions problem. | Next update |
| Julian P. | Screen share with Susan to troubleshoot SSH keys and Research 1/Research 2 access. | Next week |
| Julian P. | Use the Sandbox endpoint for migration testing. | In progress |
| Julian P. | Provide Susan with wording and the correct address for the DNS email. | Next step |
| Julian P. | Complete University of Arizona information security awareness training for VPN access. | Before VPN access |
| Susan | Meet with Julian P. about SSH keys and Research 1/Research 2 access. | Next week |
| Susan | Meet with Julian G. and Chris about the species list and which list should be used. | Next week |
| Susan | Write a user story for communicating or requesting information changes outside of the app. | Next step |
| Susan | Send the DNS email using wording provided by Julian P. | After wording is received |
| Susan | Review Julian's open PRs. | Next week |
| Susan | Work on the translator for the new file architecture so the Java app continues to work. | In progress |
| Susan | Coordinate bringing Liz and Jane into a show-and-tell session. | Next week |
| Susan | Book a room for the Thursday show-and-tell, using BSRL as a backup. | Next week |

## Open Questions

- Are Research 1 and Research 2 supposed to remain active, or were they intended to be decommissioned?
- What exact DNS record is needed for the migration process?
- Who should have permission to move uploads between collections?
- What video formats will be supported directly, and which conversions will users need to handle manually?
- Which species list should be treated as authoritative for the next stage of SPARCd?
- When should Matt be brought into the migration communication?
- What level of BMC or other out-of-band management should be added after migration?

## Near-Term Priorities

1. Review and merge the current set of non-draft PRs.
2. Resolve Research 1 and Research 2 access questions.
3. Use Sandbox for migration testing.
4. Clarify DNS requirements for migration.
5. Create the admin issue for moving uploads between collections.
6. Document current video format limitations.
7. Prepare for the Liz and Jane show-and-tell session.
