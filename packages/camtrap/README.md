# @sparcd/camtrap

Camtrap-DP-flavored types, CSV writers and readers, and the object layout the
SPARC'd tools share. The CSV shapes match what SPARC'd already writes; the
layout below says where those files and the images live in S3.

## Object layout

A store holds collections in one of two bucket shapes, and may hold both while
it moves from the old one to the new one.

### Data bucket

Any bucket whose name is not `sparcd` and does not start with `sparcd-`. The
store picks the name (for example `sparcddata`); the apps find it by what it
holds, so the layout works on any S3-compatible provider.

```
Media/<sha256>/<YYYYMMDDHHmmss>-<camera-filename>   original, written once, never deleted
Media/<sha256>/preview-640.jpg                      derived files, fixed unstamped names
Collections/<uuid>/collection.json                  display name
Collections/<uuid>/Uploads/<stamp>_<user>/          media.csv, deployments.csv, observations.csv,
                                                    UploadMeta.json, UploadComplete.json
```

App settings (locations, species, access data) live in their own settings
bucket, separate from the data.

### Legacy bucket

One bucket per collection, named `sparcd-<uuid>`, with the images inside each
upload folder:

```
Collections/<uuid>/collection.json
Collections/<uuid>/Uploads/<stamp>_<user>/<relative path>   images
Collections/<uuid>/Uploads/<stamp>_<user>/media.csv ...     manifests
```

The names `sparcd` and `sparcd-*` are reserved for this shape.

## Key convention

- **Folder.** The lowercase hex SHA-256 of the file's bytes, so the same bytes
  are stored once whichever collection or upload they arrive in.
- **Name.** `<stamp>-<camera-filename>` (`mediaKey`). The camera filename is
  the file's own name as the Uploader sanitizes it, without its folders.
- **Stamp.** Camera-local capture time as `YYYYMMDDHHmmss` (`captureStamp`):
  the camera's time, else a time the person entered, else the Uploader's
  estimate. With none of those it is fourteen zeros. The stamp is a frozen
  label: correcting a time later edits `media.csv` and never renames the object.
- **Original or derived.** A name in a hash folder that starts with fourteen
  digits and a dash is an original (`isOriginalName`). Derived files never
  start that way.
- **Content type** is set on every write.

## Rules for writers

- Before writing an original, list `Media/<sha256>/`. If it already holds an
  original, write nothing and put that key in `media.csv`. Derived files don't
  count. If a race left two originals, the alphabetically first one wins
  (`existingOriginal`).
- Write originals with `If-None-Match: *`. Nothing under `Media/` is ever
  overwritten or deleted. Deleting an upload deletes its manifest folder only.
- Write `media.csv` last. An upload folder without `media.csv` is not an upload
  yet, and readers skip it.

## Rules for readers

- `media.csv` col 0 is the full object key. Resolve it in the bucket that
  `media.csv` was read from. That holds for new uploads (keys under `Media/`)
  and for old ones (keys inside their own upload folder), wherever the folder
  lives.
- A collection is one uuid, which may appear in a data bucket and in its legacy
  `sparcd-<uuid>` bucket. Read uploads from both. When the same upload folder
  name is in both, read the data bucket's copy, so an upload copied over shows
  once.
- The same `Media/` key can appear in several uploads. Scope anything keyed by
  image to its upload.
- Observation ids are built on `mediaObjectName`: the key's tail past the hash
  folder, or past the upload folder for old keys.
