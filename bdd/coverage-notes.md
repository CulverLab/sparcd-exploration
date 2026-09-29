# Target coverage

## F1

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| F1-1 | Every image in a batch is stored and retrievable after a completed upload | covered | uploader: upload-run.feature: Every file in the batch is stored under one upload folder in the collection; uploader: upload-run.feature: Every stored object is confirmed once the batch is written | Together they store every file and verify retrieval by size or fingerprint. |
| F1-2 | Preparing a batch requires no connection until Frank chooses to upload | partial | uploader: connect-and-session.feature: A loaded uploader can inspect its first batch without network access | Drop and inspection work offline, but the full preparation flow is not covered. |
| F1-3 | A partial transfer is never presented as a completed upload | covered | uploader: upload-run.feature: The upload is only published once every file has landed; uploader: upload-run.feature: A batch where some files failed is left unpublished and shown as partial | Together they keep partial data unpublished and label the run partial. |
| F1-4 | Frank can tell at a glance whether he is currently able to upload | partial | uploader: upload-run.feature: The run monitor shows one offline warning per outage, not one per poll tick | Offline and recovery are logged, but upload availability is not checked at a glance. |
| F1-5 | An incomplete upload continues from where it stopped | covered | uploader: resume-and-retry.feature: An interrupted upload can be continued from where it stopped; uploader: resume-and-retry.feature: Files already stored and verified are not sent again | Together they resume at the stopping point and skip verified objects. |
| F1-6 | Only image files are taken from the SD card | partial | uploader: choose-folder.feature: Only JPEG images and MP4 videos are taken from the chosen folder | Non-media is excluded, but MP4 video is accepted while the target says only images. |
| F1-7 | An upload that never completes does not add images to the collection | covered | uploader: upload-run.feature: An upload that fails or is abandoned announces nothing | Without published metadata, collection readers see no abandoned images. |

## F2

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| F2-1 | Only locations valid for the chosen collection can be assigned | partial | uploader: assign-collection-and-deployment.feature: Locations the chosen collection has already used are offered first | Collection locations are prioritized, not enforced. |
| F2-2 | A location outside the collection cannot be assigned | missing | — | Outside locations are allowed rather than refused. |
| F2-3 | An upload cannot be finalized while any batch is missing a location | partial | uploader: assign-collection-and-deployment.feature: The batch cannot be uploaded until a camera location is assigned | The single-batch gate requires a location but does not handle or name multiple batches. |
| F2-4 | An upload can be finalized once every batch has a location | partial | uploader: assign-collection-and-deployment.feature: The batch cannot be uploaded until a camera location is assigned | A located single batch continues; all batches in a multi-batch upload are not checked. |
| F2-5 | Each stored image carries the location Frank assigned to its batch | partial | uploader: upload-run.feature: Every file in the batch is stored under one upload folder in the collection | Deployment metadata is stored, but image locations are not compared with the assignment. |
| F2-6 | Batches from different cards keep their own separate locations | missing | — | The uploader models one batch and one deployment, not separate card locations. |

## F3

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| F3-1 | The identification team can see that new untagged data is available | partial | tagger: browse-collections-and-uploads.feature: Uploads can be narrowed to those still needing work | Untagged uploads are visible, but no responsible-team announcement exists. |
| F3-2 | The announcement says what was uploaded | partial | tagger: browse-collections-and-uploads.feature: Each upload shows its date, uploader, location, size and tagging progress | Browse shows the fields in context, but no announcement carries them. |
| F3-3 | A failed upload announces nothing | partial | uploader: upload-run.feature: An upload that fails or is abandoned announces nothing | Vacuous: no tool announces anything yet, so nothing can be announced for a failed upload. |
| F3-4 | An abandoned upload announces nothing | partial | uploader: upload-run.feature: An upload that fails or is abandoned announces nothing | Vacuous: no tool announces anything yet, so nothing can be announced for an abandoned upload. |
| F3-5 | An announcement does not reveal a protected location | missing | tagger: F4-location-visibility.feature: The tagger applies no species-based or location-based restriction | The tagger withholds no sensitive location information. |
| F3-6 | Frank can add his own notes to the announcement | partial | uploader: assign-collection-and-deployment.feature: A description can be recorded with the batch | Free text can be stored or omitted, but no announcement carries it. |

## F4

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| F4-1 | Precise sensitive locations are invisible to anyone outside the authorized members | missing | tagger: F4-location-visibility.feature: The tagger applies no species-based or location-based restriction | The tagger reveals locations allowed by the credentials. |
| F4-2 | Precise sensitive locations are absent from exports and reports | missing | — | No export or report scenario removes precise sensitive locations. |
| F4-3 | A precise sensitive location cannot be recovered indirectly | untestable | — | NOTES.md calls this a universal negative over an open set of channels. |
| F4-4 | Permission to view or identify images does not by itself reveal sensitive locations | missing | tagger: F4-location-visibility.feature: The tagger applies no species-based or location-based restriction | Identification access triggers no location protection. |
| F4-5 | Frank is told the protection state before he commits to an upload | missing | — | No scenario shows protection state before upload. |
| F4-6 | Protection cannot be removed silently | missing | — | No scenario authorizes and audits removal of protection. |
| F4-7 | A single compromised account cannot widen sensitive-location exposure | untestable | — | NOTES.md classifies this as an architectural authorization property. |
| F4-8 | Data in unauthorized collections cannot be read, changed or deleted | missing | tagger: browse-collections-and-uploads.feature: Only collections the credentials can read are offered | UI filtering does not prove read, change, and delete refusal with no side effects. |
| F4-9 | Original uploaded data survives every later change | untestable | tagger: sync-identifications-to-the-collection.feature: The previous state is preserved before anything is replaced | Snapshots exist, but NOTES.md says retention and audit policy remain undefined. |
| F4-10 | An action outside a user's permissions is refused outright | missing | — | No scenario verifies full refusal of an unauthorized action. |

## A1

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| A1-1 | Tags assigned without a connection are retained | covered | tagger: local-batch.feature: A species applied to an image is kept on the batch; tagger: local-batch.feature: Coming back to the batch resumes the tagging | Together they retain an offline tag and show it again when the batch is reopened. |
| A1-2 | Images and their tags enter the system in a single upload | covered | uploader: tag-before-upload.feature: The upload carries the images and the identifications together | Images and applied species are published in one pass. |
| A1-3 | Untagged images are accepted and marked as untagged | covered | uploader: tag-before-upload.feature: An untagged file is accepted and published as untagged | Tagged and untagged files publish together; untagged files have no species row. |
| A1-4 | An upload with no tags at all is still accepted | covered | uploader: upload-run.feature: A batch with no species identifications is accepted and recorded as untagged | A wholly untagged batch publishes with placeholder rows and a zero-tag count. |
| A1-5 | Tags made before upload are attributed to Anita | missing | — | No scenario attributes a pre-upload identification to its maker. |
| A1-6 | Tags are not lost while waiting for a connection | partial | tagger: local-batch.feature: Coming back to the batch resumes the tagging | Tags survive reopening, but no scenario waits days and verifies uploaded data. |

## A2

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| A2-1 | Only locations valid for her collection can be assigned | missing | uploader: assign-collection-and-deployment.feature: Locations the chosen collection has already used are offered first | Used locations come first, but every registry location remains selectable. |
| A2-2 | A location outside her collection cannot be assigned | missing | — | The uploader does not refuse registry locations outside the collection. |
| A2-3 | The upload cannot be finalized without a location | covered | uploader: assign-collection-and-deployment.feature: The batch cannot be uploaded until a camera location is assigned | Continue is disabled and explains that a deployment is required. |
| A2-4 | The stored location matches what Anita assigned | missing | — | No scenario compares every stored image with the assigned location. |
| A2-5 | The location applies to the identifications she already made | missing | — | No scenario ties pre-upload identifications to the assigned location. |

## AL1

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| AL1-1 | An interrupted upload continues on its own when the connection returns | partial | uploader: upload-run.feature: The run monitor shows one offline warning per outage, not one per poll tick | A live run does resume by itself when the network returns, but the scenario only waits for that inside its When step and asserts log lines; no Then states that the upload continued without a manual restart. |
| AL1-2 | Data already transferred and verified is not sent again | covered | uploader: resume-and-retry.feature: Files already stored and verified are not sent again | Verified objects are skipped; only missing or mismatched objects are sent. |
| AL1-3 | An unattended upload is found either complete or clearly resumable | partial | uploader: resume-and-retry.feature: An interrupted upload is listed as open, never as complete | Shows the upload as open with done and failed counts, but no named step shows what is needed to carry on. |
| AL1-4 | An upload is never left in a silent, stuck state | untestable | uploader: resume-and-retry.feature: An interrupted upload is listed as open, never as complete | NOTES.md says no threshold defines when silence becomes stuck. |
| AL1-5 | Repeated interruptions still end in one finished upload | partial | uploader: resume-and-retry.feature: Retrying the failed files of a partial run completes that same upload | Retry leaves one upload, but repeated connection interruptions are not exercised. |
| AL1-6 | An interrupted upload is not presented as complete | covered | uploader: resume-and-retry.feature: An interrupted upload is listed as open, never as complete | Only uploads with published metadata are marked complete. |

## AL2

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| AL2-1 | The retry targets the same collection and location as the original attempt | covered | uploader: resume-and-retry.feature: A resumed upload lands in the same place as the original attempt | The recorded collection, folder, object paths, and deployment are reused. |
| AL2-2 | The destination ends up with exactly one upload | covered | uploader: resume-and-retry.feature: Retrying the failed files of a partial run completes that same upload | The same folder is published and exactly one upload remains. |
| AL2-3 | No leftover partial data from the failed attempt remains | partial | uploader: resume-and-retry.feature: Retrying the failed files of a partial run completes that same upload | Stored files remain and the same folder completes, but all failed-attempt residue is not checked. |
| AL2-4 | Retrying does not require re-entering the location | covered | uploader: resume-and-retry.feature: Retrying does not require choosing the location again | The collection and deployment are not requested again. |
| AL2-5 | Retrying does not require re-identifying species already tagged | partial | uploader: resume-and-retry.feature: A resumed upload lands in the same place as the original attempt | Vacuous: the resumed batch has no species identified, so nothing shows identifications surviving a retry. |
| AL2-6 | A retry cannot be misdirected to a different destination by accident | covered | uploader: resume-and-retry.feature: A resumed upload lands in the same place as the original attempt | The retry cannot silently change its recorded destination. |

## H1

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| H1-1 | Detail becomes legible well beyond the fit-to-screen size | untestable | tagger: H1-examine-images-closely.feature: An image can be enlarged well beyond its fit-to-screen size | NOTES.md says legibility lacks an agreed minimum magnification. |
| H1-2 | Harold can move around an enlarged image | covered | tagger: H1-examine-images-closely.feature: The enlarged image can be moved around | Dragging reaches the image bounds without moving beyond them. |
| H1-3 | Harold can return to seeing the whole image | covered | tagger: H1-examine-images-closely.feature: Returning to the fitted view is one action away once zoomed | Reset returns the image to fitted view. |
| H1-4 | Zooming and panning stay responsive on a small, low-powered laptop | untestable | tagger: H1-examine-images-closely.feature: Only the images on screen are rendered while scrolling a large upload | NOTES.md says responsiveness lacks a device class and delay threshold. |
| H1-5 | Moving to another image does not carry over a confusing zoom state | covered | tagger: H1-examine-images-closely.feature: Moving to another image starts it fitted to the pane | The next image starts fitted without prior zoom or pan. |
| H1-6 | Close examination works on images of differing sizes and shapes | missing | — | No scenario compares differing sizes and aspect ratios. |

## H2

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| H2-1 | An assigned species is saved and visible to others with access | untestable | tagger: sync-identifications-to-the-collection.feature: Synced identifications become visible to everyone with access | NOTES.md says visibility lacks a propagation-delay threshold. |
| H2-2 | An image can carry more than one species | covered | tagger: H2-assign-species-to-images.feature: An image can carry more than one species | Both species remain and neither replaces the other. |
| H2-3 | Identifications are attributed to the person who made them | partial | tagger: connect-and-session.feature: The tagger identity is entered in Settings and stamps every sync | Sync has an identity, but identification rows do not assert maker attribution. |
| H2-4 | Only species valid for the collection can be assigned | missing | tagger: H2-assign-species-to-images.feature: The species list is browsable, not only searchable | The loaded vocabulary is not constrained per collection. |
| H2-5 | An image Harold has identified is no longer counted as untagged | covered | tagger: H2-assign-species-to-images.feature: Dragging a species tile onto the focused image adds it at count one | The image tile changes from untagged to the assigned species. |
| H2-6 | Harold can leave an image he cannot identify without tagging it | partial | tagger: H3-review-existing-identifications.feature: Existing identifications are shown on the images that carry them | Untagged images display correctly, but moving on without recording a species is not tested. |
| H2-7 | Identifying an image does not by itself reveal a protected location | missing | tagger: F4-location-visibility.feature: The tagger applies no species-based or location-based restriction | The tagger has no sensitive-location restriction. |

## H3

| ID | target scenario title | status | as-built scenarios | reason |
| --- | --- | --- | --- | --- |
| H3-1 | Existing identifications are shown when Harold opens the image | covered | tagger: H3-review-existing-identifications.feature: The focused image's identifications and counts are listed in full | Focus lists every species and count. |
| H3-2 | Harold can confirm an existing identification | partial | tagger: H3-review-existing-identifications.feature: A review that changes nothing leaves the stored data untouched | The value remains, but no review record is created. |
| H3-3 | Harold can correct an existing identification | partial | tagger: H3-review-existing-identifications.feature: A recorded count can be corrected; tagger: H3-review-existing-identifications.feature: A correction is attributed to the person who synced it | Correction and audit identity exist, but species correction is not recorded explicitly. |
| H3-4 | Harold can remove an existing identification | partial | tagger: H3-review-existing-identifications.feature: A single wrong identification can be removed without losing the others; tagger: sync-identifications-to-the-collection.feature: Detagging an image and syncing writes a blank placeholder row rather than removing the row | Removal is stored, but no removal record is asserted. |
| H3-5 | A review records who carried it out | partial | tagger: H3-review-existing-identifications.feature: A correction is attributed to the person who synced it | Correction records identity and time; confirmation without change records no reviewer. |
| H3-6 | The original identifier's work remains attributable | missing | — | No scenario displays original attribution beside a separate review. |
| H3-7 | A review does not destroy the original uploaded data | partial | tagger: sync-identifications-to-the-collection.feature: The previous state is preserved before anything is replaced; tagger: H3-review-existing-identifications.feature: A correction is attributed to the person who synced it | The change is traceable, but the stored files are replaced and the upload record is rewritten on sync; the original survives only as a snapshot copy. |
| H3-8 | Harold can tell reviewed identifications from unreviewed ones | missing | tagger: H3-review-existing-identifications.feature: An image edited locally is distinguishable from one that is not | The marker means unsynced edit, not reviewed versus unreviewed. |

## Totals

| story | covered | partial | missing | untestable | total |
| --- | ---: | ---: | ---: | ---: | ---: |
| F1 | 4 | 3 | 0 | 0 | 7 |
| F2 | 0 | 4 | 2 | 0 | 6 |
| F3 | 0 | 5 | 1 | 0 | 6 |
| F4 | 0 | 0 | 7 | 3 | 10 |
| A1 | 4 | 1 | 1 | 0 | 6 |
| A2 | 1 | 0 | 4 | 0 | 5 |
| AL1 | 2 | 3 | 0 | 1 | 6 |
| AL2 | 4 | 2 | 0 | 0 | 6 |
| H1 | 3 | 0 | 1 | 2 | 6 |
| H2 | 2 | 2 | 2 | 1 | 7 |
| H3 | 1 | 5 | 2 | 0 | 8 |
| Overall | 21 | 25 | 20 | 7 | 73 |
