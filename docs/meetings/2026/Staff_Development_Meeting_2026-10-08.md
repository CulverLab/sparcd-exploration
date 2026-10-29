# Staff Development Meeting Summary
**Date:** October 8, 2026

## Overview

The team reviewed Data Explorer and upload issues, planned a staged migration from the current MinIO server to Jetstream, and discussed protecting sensitive wildlife data. Immediate priorities are to merge and test application fixes, rehearse the migration in the sandbox, and introduce Liz and Jane to the new upload and tagging applications before the October 31 demonstration.

## Main Discussion and Decisions

- **Application fixes and testing:** Susan reported successful testing of the new Explorer version, alongside continuing MinIO upload problems. The team discussed a bug involving file versions and WebAssembly (WASM) creation, pending pull requests, and improvements to automated build testing. Local computer performance may also be contributing to upload difficulties.
- **Migration readiness:** The team favored testing the full transition in the sandbox before moving production. The proposed approach uses a stable DNS endpoint, synchronized data, and a switch to the Jetstream proxy, with minimal interruption expected. Production migration timing remains dependent on successful testing and readiness for the October 31 demonstration.
- **Sensitive data and AI security:** Susan raised concerns about unauthorized discovery or exposure of jaguar location data and whether AI tools could use sensitive information. The discussion covered encryption, proxy-based access controls, and secure key management. These concerns were discussed; the notes do not establish that an exposure occurred.
- **Infrastructure and recovery:** Julian distinguished Jetstream's compute role from the Open Storage Network's storage role. The team discussed backup storage, proxy redundancy, deployment automation, an architecture flowchart, and a documented recovery process. More advanced features, including controlled agent environments, thumbnails, and data preprocessing, remain longer-term possibilities.
- **Training and project governance:** Liz and Jane should review the new upload and tagging applications before the demonstration. The team also discussed making nonprofit and donation information more visible on the website and reviewing questions about data ownership, access, and project continuity.

## Proposed Sandbox Migration Sequence

1. Create a sandbox DNS endpoint pointing to the current MinIO server and shorten its time-to-live (TTL) to support a faster switch.
2. Confirm University of Arizona DNS requirements and resolve the SSH/key issue between the proxy and MinIO.
3. Give Chris authenticated sandbox access so he can upload test files and help validate the transition.
4. Synchronize data, switch DNS to the Jetstream proxy using the agreed DNS configuration, and test uploads and data access.
5. Complete the final synchronization and retire the old sandbox endpoint after the transition is verified. Document the process before applying it to production.

## Action Items

### Julian

- Merge the latest Explorer fixes into `main` and notify Susan when they are ready to test.
- Confirm that the latest pull requests follow the intended proxy and encryption architecture.
- Set up the sandbox DNS endpoint, shorten its TTL, and coordinate the proposed CNAME change with University of Arizona DNS administrators.
- Resolve the SSH/key problem preventing proxy communication with MinIO; coordinate with Susan if additional access is needed.
- Coordinate Chris's sandbox access and rehearse the migration, including synchronization, DNS switching, and validation.
- After migration, prepare a runbook covering deployment, backups, proxy redundancy, and disaster recovery.

### Susan

- Pull the updated `main` branch after the fixes are merged and test uploads and Explorer functionality locally.
- Begin using the new upload and tagging applications for her own work and report problems promptly.
- Arrange an introductory review and training meeting with Liz and Jane during the week following October 8, ahead of October 31.
- Make nonprofit and donation information more prominent on the Wildcat Center website.
- Continue reviewing data ownership, access, and project governance questions.

### Julian and Susan

- Schedule a technical follow-up, proposed for **Thursday at 2:00 p.m.**, to review migration readiness, DNS changes, and remaining issues.

## Details to Confirm

- **Chris's sandbox access:** The action list assigns this to Julian, while another passage tentatively assigns it to Susan. Confirm the owner.
- **Follow-up meeting:** Confirm the calendar date and time zone for the proposed Thursday meeting.
- **Deployment timing:** The notes contain an unclear reference to keeping the system “interrupted for a week.” Confirm whether this meant pausing deployments or actual service downtime.
- **Infrastructure deadline:** Verify the reported September 2027 Jetstream 2 deadline and what it requires.
- **Security and ownership:** Final encryption and key-management choices, backup providers, and legal/data-ownership questions remain unresolved.

