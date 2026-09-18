# Vocabulary terms used in SPARCd

Terms used consistently across the tools and their code, so a name means the
same thing everywhere it's used.

**Collection**: A unique top-level identifier for a group of Uploads. These
can be associated with individuals, organizations, or projects.

**Deployment**: The camera Location an Upload was recorded at. This is the
data model's name for it (`Deployment`, `deployments.csv`) — the tools'
own UI calls the same thing a "Location" (e.g. "Correct the recorded camera
location"). Also see Location.

**Draft**: A local edit held in the browser until a Sync writes it
back to the storage endpoint (which is specified at login time) — the difference
between what's on screen and what's already been saved.

**Location**: The pre-defined place a camera has been put to capture images.
When referring to the data model, the term "Deployment" is used as substitute
for a location. Also see Deployment.

**Observation**: A single species identification recorded against an image — a
species, a count, and any notes. In the data model the `observations.csv`
file holds one row per Observation.

**Snapshot**: An unchangeable backup of a Collection/Upload's saved metadata
files (`media.csv`, `observations.csv`, `UploadMeta.json`) — not the image
files themselves — taken just before a Sync, so the metadata changes made by
a Sync can be undone.

**Species**: A predefined scientific name paired with a common name. May also
be used to refer to the list of these name pairs (although using "species
list" is more common).

**Storage endpoint**: The Endpoint URL specified at login time. This is an
S3-compatible storage solution where all files are stored.

**Sync**: The action that writes local Drafts (changes) back to the saved
files at the storage endpoint, always preceded by a Snapshot. A Sync updates
the files on the storage endpoint.

**Upload**: A group of images from a single camera's SD card that is stored
as part of a Collection. Consists of the image files, the Location, the
Species identified, and other related information.
