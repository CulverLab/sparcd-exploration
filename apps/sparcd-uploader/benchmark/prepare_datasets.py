#!/usr/bin/env python3
"""Build reproducible SPARCd upload benchmark datasets outside the repository."""

import argparse
import base64
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
import shutil
import struct
import subprocess
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

MIB = 1024 * 1024
GIB = 1024 * MIB
SOURCE_PREFIX = "snapshotserengeti-unzipped/"
AZURE_CONTAINER = "https://lilawildlife.blob.core.windows.net/lila-wildlife"
METADATA_URL = (
    f"{AZURE_CONTAINER}/snapshotserengeti-v-2-0/SnapshotSerengetiS03.json.zip"
)
METADATA_SHA256 = "b2732aa283b1d1dde03b210f0951dd0a587ec8c659818aecb5b986e36cd78962"
LICENSE_URL = "https://cdla.io/permissive-1-0/"
DATASET_PAGE = "https://lila.science/datasets/snapshot-serengeti"
DEFAULT_ROOT = Path.home() / "data" / "sparcd-uploader-benchmark" / "v1"
MEDIA_SUFFIXES = {".jpg", ".jpeg", ".mp4"}


def select_images(blobs, count, target_size):
    return sorted(
        blobs, key=lambda item: (abs(item["size"] - target_size), item["name"])
    )[:count]


def _padding_block(seed, size=65533):
    return hashlib.shake_256(seed.encode()).digest(size)


def pad_jpeg(path, target_size, seed):
    path = Path(path)
    original_size = path.stat().st_size
    remaining = target_size - original_size
    if remaining < 4:
        raise ValueError("JPEG target must add at least four bytes")
    block = _padding_block(seed)
    with path.open("r+b") as output:
        content = output.read()
        eoi = content.rfind(b"\xff\xd9")
        if eoi < 0:
            raise ValueError(f"JPEG lacks EOI marker: {path}")
        suffix = content[eoi:]
        output.seek(eoi)
        output.truncate()
        while remaining:
            segment_size = min(65537, remaining)
            leftover = remaining - segment_size
            if 0 < leftover < 4:
                segment_size -= 4 - leftover
            payload_size = segment_size - 4
            output.write(b"\xff\xfe")
            output.write(struct.pack(">H", payload_size + 2))
            output.write(block[:payload_size])
            remaining -= segment_size
        output.write(suffix)
    if path.stat().st_size != target_size:
        raise RuntimeError(f"JPEG size mismatch: {path}")


def pad_mp4(path, target_size, seed):
    path = Path(path)
    padding = target_size - path.stat().st_size
    if not 8 <= padding <= 0xFFFFFFFF:
        raise ValueError("MP4 padding must fit one 32-bit free box")
    block = _padding_block(seed, MIB)
    with path.open("ab") as output:
        output.write(struct.pack(">I4s", padding, b"free"))
        remaining = padding - 8
        while remaining:
            chunk = block[: min(remaining, len(block))]
            output.write(chunk)
            remaining -= len(chunk)
    if path.stat().st_size != target_size:
        raise RuntimeError(f"MP4 size mismatch: {path}")


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(8 * MIB):
            digest.update(chunk)
    return digest.hexdigest()


def md5_base64_file(path):
    digest = hashlib.md5(usedforsecurity=False)
    with Path(path).open("rb") as source:
        while chunk := source.read(8 * MIB):
            digest.update(chunk)
    return base64.b64encode(digest.digest()).decode()


def request_bytes(url, headers=None, attempts=4):
    request = urllib.request.Request(
        url, headers={"User-Agent": "sparcd-benchmark/1", **(headers or {})}
    )
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except Exception:
            if attempt == attempts:
                raise
            time.sleep(attempt)


def list_source_blobs(pages):
    marker = ""
    blobs = []
    for _ in range(pages):
        query = urllib.parse.urlencode(
            {
                "restype": "container",
                "comp": "list",
                "prefix": f"{SOURCE_PREFIX}S3/",
                "maxresults": 5000,
                "marker": marker,
            }
        )
        root = ET.fromstring(request_bytes(f"{AZURE_CONTAINER}?{query}"))
        for blob in root.findall("./Blobs/Blob"):
            name = blob.findtext("Name")
            size = int(blob.findtext("./Properties/Content-Length"))
            if name and name.lower().endswith((".jpg", ".jpeg")):
                blobs.append(
                    {
                        "blob_name": name,
                        "name": name.removeprefix(SOURCE_PREFIX),
                        "size": size,
                        "etag": blob.findtext("./Properties/Etag"),
                        "content_md5": blob.findtext("./Properties/Content-MD5"),
                        "last_modified": blob.findtext("./Properties/Last-Modified"),
                    }
                )
        marker = root.findtext("NextMarker") or ""
        if not marker:
            break
    return blobs


def ensure_metadata_zip(root):
    path = root / "sources" / "SnapshotSerengetiS03.json.zip"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or sha256_file(path) != METADATA_SHA256:
        temporary = path.with_suffix(".part")
        temporary.write_bytes(request_bytes(METADATA_URL))
        if sha256_file(temporary) != METADATA_SHA256:
            temporary.unlink(missing_ok=True)
            raise RuntimeError("Snapshot Serengeti metadata SHA-256 mismatch")
        temporary.replace(path)
    return path


def add_capture_metadata(selection, metadata_zip):
    try:
        import ijson
    except ImportError as error:
        raise SystemExit(
            "ijson required: uv run --with ijson python prepare_datasets.py ..."
        ) from error
    wanted = {item["name"] for item in selection}
    found = {}
    with (
        zipfile.ZipFile(metadata_zip) as archive,
        archive.open(archive.namelist()[0]) as source,
    ):
        for image in ijson.items(source, "images.item"):
            name = image.get("file_name")
            if name in wanted:
                found[name] = {
                    "capture_time": (image.get("datetime") or "").replace(" ", "T")
                    + "Z",
                    "width": image.get("width"),
                    "height": image.get("height"),
                    "corrupt": bool(image.get("corrupt")),
                }
                if len(found) == len(wanted):
                    break
    missing = wanted - found.keys()
    if missing:
        raise RuntimeError(f"metadata missing for {len(missing)} selected images")
    for item in selection:
        item.update(found[item["name"]])
        item["url"] = (
            f"{AZURE_CONTAINER}/{urllib.parse.quote(item['blob_name'], safe='/')}"
        )
    return selection


def download_one(item, destination_root):
    destination = destination_root / item["name"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    if (
        destination.exists()
        and destination.stat().st_size == item["size"]
        and md5_base64_file(destination) == item["content_md5"]
    ):
        return False
    temporary = destination.with_name(destination.name + ".part")
    request = urllib.request.Request(
        item["url"],
        headers={"User-Agent": "sparcd-benchmark/1", "If-Match": item["etag"]},
    )
    for attempt in range(1, 5):
        try:
            digest = hashlib.md5(usedforsecurity=False)
            with (
                urllib.request.urlopen(request, timeout=120) as response,
                temporary.open("wb") as output,
            ):
                while chunk := response.read(MIB):
                    output.write(chunk)
                    digest.update(chunk)
            if temporary.stat().st_size != item["size"]:
                raise RuntimeError(f"size mismatch for {item['name']}")
            if base64.b64encode(digest.digest()).decode() != item["content_md5"]:
                raise RuntimeError(f"Content-MD5 mismatch for {item['name']}")
            temporary.replace(destination)
            return True
        except Exception:
            temporary.unlink(missing_ok=True)
            if attempt == 4:
                raise
            time.sleep(attempt)
    return False


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")
    temporary.replace(path)


def prepare_source(root, list_pages, workers):
    selection_path = root / "sources" / "snapshot-serengeti-s03-selection.json"
    metadata_zip = ensure_metadata_zip(root)
    if selection_path.exists():
        selection = json.loads(selection_path.read_text())["images"]
    else:
        candidates = list_source_blobs(list_pages)
        if len(candidates) < 1000:
            raise RuntimeError(f"only {len(candidates)} source images listed")
        pool = add_capture_metadata(
            select_images(candidates, 1200, 256 * 1024), metadata_zip
        )
        selection = select_images(
            [item for item in pool if not item["corrupt"]], 1000, 256 * 1024
        )
        if len(selection) != 1000:
            raise RuntimeError("fewer than 1000 non-corrupt source images")
        write_json(
            selection_path,
            {
                "dataset_page": DATASET_PAGE,
                "license": LICENSE_URL,
                "metadata_url": METADATA_URL,
                "metadata_sha256": METADATA_SHA256,
                "selection_rule": f"1000 nearest non-corrupt images to 256 KiB by size then path among first {list_pages} Azure pages",
                "images": selection,
            },
        )
    destination = root / "datasets" / "S1"
    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(download_one, item, destination) for item in selection
        ]
        for future in concurrent.futures.as_completed(futures):
            future.result()
            completed += 1
            if completed % 100 == 0:
                print(
                    f"source_download_progress={completed}/{len(selection)}", flush=True
                )
    return selection


def set_capture_mtime(path, capture_time):
    timestamp = (
        dt.datetime.fromisoformat(capture_time.removesuffix("Z"))
        .replace(tzinfo=dt.timezone.utc)
        .timestamp()
    )
    os.utime(path, (timestamp, timestamp))


def copy_padded_jpeg(source, destination, target_size, seed, capture_time):
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".part")
    shutil.copyfile(source, temporary)
    pad_jpeg(temporary, target_size, seed)
    # Compare by content, not just size, so a same-sized but altered derivative
    # is always replaced rather than silently accepted into the manifest.
    if destination.exists() and sha256_file(destination) == sha256_file(temporary):
        temporary.unlink()
    else:
        temporary.replace(destination)
    set_capture_mtime(destination, capture_time)


def build_derived(root, selection):
    metadata = {}
    selection_by_name = {item["name"]: item for item in selection}
    s1_root = root / "datasets" / "S1"
    s1_files = sorted(
        path for path in s1_root.rglob("*") if path.suffix.lower() in {".jpg", ".jpeg"}
    )
    if len(s1_files) != 1000:
        raise RuntimeError(f"S1 expected 1000 images, found {len(s1_files)}")
    for path in s1_files:
        item = selection_by_name[path.relative_to(s1_root).as_posix()]
        metadata[f"S1/{path.relative_to(s1_root).as_posix()}"] = {
            "capture_time": item["capture_time"],
            "provenance": item["url"],
        }

    for index, source in enumerate(s1_files[:200]):
        item = selection_by_name[source.relative_to(s1_root).as_posix()]
        relative = Path(f"image-{index:04d}-{source.name}")
        destination = root / "datasets" / "S2" / relative
        copy_padded_jpeg(
            source, destination, 5 * MIB, f"S2:{index}", item["capture_time"]
        )
        metadata[f"S2/{relative.as_posix()}"] = {
            "capture_time": item["capture_time"],
            "provenance": item["url"],
            "derivation": "valid JPEG COM padding to 5 MiB",
        }

    for index, source in enumerate(s1_files[:128]):
        item = selection_by_name[source.relative_to(s1_root).as_posix()]
        target = (7 if index < 64 else 9) * MIB
        relative = Path(f"image-{index:04d}-{source.name}")
        destination = root / "datasets" / "S3" / relative
        copy_padded_jpeg(
            source, destination, target, f"S3:{index}", item["capture_time"]
        )
        metadata[f"S3/{relative.as_posix()}"] = {
            "capture_time": item["capture_time"],
            "provenance": item["url"],
            "derivation": f"valid JPEG COM padding to {target // MIB} MiB",
        }

    s4_root = root / "datasets" / "S4"
    for index in range(10):
        capture_time = f"2026-01-{index + 1:02d}T12:00:00Z"
        destination = s4_root / f"video-{index:02d}.mp4"
        if not destination.exists() or destination.stat().st_size != 100 * MIB:
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name(
                f"{destination.stem}.part{destination.suffix}"
            )
            temporary.unlink(missing_ok=True)
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    f"testsrc2=size=640x360:rate=15,hue=h={index * 36}",
                    "-t",
                    "2",
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-crf",
                    "23",
                    "-metadata",
                    f"creation_time={capture_time}",
                    "-movflags",
                    "+faststart",
                    str(temporary),
                ],
                check=True,
            )
            pad_mp4(temporary, 100 * MIB, f"S4:{index}")
            temporary.replace(destination)
        set_capture_mtime(destination, capture_time)
        metadata[f"S4/{destination.name}"] = {
            "capture_time": capture_time,
            "provenance": "synthetic ffmpeg testsrc2",
            "derivation": "valid MP4 free-box padding to 100 MiB",
        }

    s5_root = root / "datasets" / "S5"
    for dataset in ("S1", "S2", "S3", "S4"):
        dataset_root = root / "datasets" / dataset
        for source in sorted(
            path
            for path in dataset_root.rglob("*")
            if path.suffix.lower() in MEDIA_SUFFIXES
        ):
            relative = source.relative_to(dataset_root)
            destination = s5_root / f"from-{dataset}" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                os.link(source, destination)
            elif os.stat(source).st_ino != os.stat(destination).st_ino:
                raise RuntimeError(f"unexpected existing S5 file: {destination}")
    total = sum(path.stat().st_size for path in s5_root.rglob("*") if path.is_file())
    repeats = sorted(root.glob("datasets/S2/*"))
    repeat_index = 0
    while total < 5 * GIB:
        source = repeats[repeat_index % len(repeats)]
        destination = s5_root / "repeat" / f"repeat-{repeat_index:05d}-{source.name}"
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            os.link(source, destination)
            total += source.stat().st_size
        repeat_index += 1
    write_json(root / "state" / "file-metadata.json", metadata)
    write_provenance(root)


def write_provenance(root):
    text = f"""# SPARCd benchmark dataset provenance

- Real JPEG source: Snapshot Serengeti season 3, LILA BC
- Dataset page: {DATASET_PAGE}
- License: Community Data License Agreement Permissive 1.0 ({LICENSE_URL})
- Citation: Swanson AB et al. (2015), Snapshot Serengeti, Scientific Data 2:150026, https://doi.org/10.1038/sdata.2015.26
- Metadata URL: {METADATA_URL}
- Metadata SHA-256: `{METADATA_SHA256}`
- Privacy: LILA states human-class images were removed from this release.
- S1: bounded real-image selection.
- S2/S3: S1 JPEG derivatives padded with valid JPEG COM segments.
- S4: synthetic ffmpeg MP4 files padded with valid top-level `free` boxes.
- S5: hard-linked S1-S4 media plus repeated S2 hard links to approximately 5 GiB.

Do not publish or redistribute derived files without preserving this provenance and license notice.
"""
    (root / "PROVENANCE.md").write_text(text)


def media_files(dataset_root):
    return sorted(
        path
        for path in dataset_root.rglob("*")
        if path.is_file() and path.suffix.lower() in MEDIA_SUFFIXES
    )


def validate_decode(paths, workers):
    unique = {}
    for path in paths:
        stat = path.stat()
        unique.setdefault((stat.st_dev, stat.st_ino), path)

    def check(path):
        command = (
            ["identify", "-ping", str(path)]
            if path.suffix.lower() in {".jpg", ".jpeg"}
            else ["ffprobe", "-v", "error", str(path)]
        )
        subprocess.run(
            command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        list(executor.map(check, unique.values()))
    return len(unique)


def write_manifests(root, workers, decode, write):
    source_metadata = json.loads((root / "state" / "file-metadata.json").read_text())
    inode_metadata = {}
    for key, value in source_metadata.items():
        path = root / "datasets" / key
        stat = path.stat()
        inode_metadata[(stat.st_dev, stat.st_ino)] = value
    hash_cache = {}
    all_paths = []
    summaries = {}
    manifests = root / "manifests"
    if write:
        manifests.mkdir(parents=True, exist_ok=True)
    elif not manifests.is_dir():
        raise RuntimeError("manifest directory missing")
    for dataset in ("S1", "S2", "S3", "S4", "S5"):
        dataset_root = root / "datasets" / dataset
        paths = media_files(dataset_root)
        records = []
        for path in paths:
            stat = path.stat()
            inode = (stat.st_dev, stat.st_ino)
            if inode not in hash_cache:
                hash_cache[inode] = sha256_file(path)
            digest = hash_cache[inode]
            details = inode_metadata[inode]
            records.append(
                {
                    "relative_path": path.relative_to(dataset_root).as_posix(),
                    "bytes": stat.st_size,
                    "sha256": digest,
                    "media_type": "image/jpeg"
                    if path.suffix.lower() in {".jpg", ".jpeg"}
                    else "video/mp4",
                    "capture_time": details["capture_time"],
                    "provenance": details["provenance"],
                    **(
                        {"derivation": details["derivation"]}
                        if "derivation" in details
                        else {}
                    ),
                }
            )
        manifest = manifests / f"{dataset}.jsonl"
        content = "".join(
            json.dumps(record, sort_keys=True) + "\n" for record in records
        )
        manifest_hash = hashlib.sha256(content.encode()).hexdigest()
        checksum = f"{manifest_hash}  {manifest.name}\n"
        checksum_path = manifests / f"{dataset}.jsonl.sha256"
        if write:
            manifest.write_text(content)
            checksum_path.write_text(checksum)
        elif not manifest.is_file() or manifest.read_text() != content:
            raise RuntimeError(f"{dataset} manifest mismatch")
        elif not checksum_path.is_file() or checksum_path.read_text() != checksum:
            raise RuntimeError(f"{dataset} manifest checksum mismatch")
        summaries[dataset] = {
            "files": len(records),
            "bytes": sum(record["bytes"] for record in records),
            "manifest_sha256": manifest_hash,
        }
        all_paths.extend(paths)
    if decode:
        summaries["decode_validation"] = {
            "unique_inodes": validate_decode(all_paths, workers),
            "passed": True,
        }
    if write:
        write_json(manifests / "summary.json", summaries)
    return summaries


def verify_shape(summaries):
    expected_counts = {"S1": 1000, "S2": 200, "S3": 128, "S4": 10}
    for dataset, count in expected_counts.items():
        if summaries[dataset]["files"] != count:
            raise RuntimeError(f"{dataset} file count mismatch")
    if summaries["S2"]["bytes"] != 200 * 5 * MIB:
        raise RuntimeError("S2 byte count mismatch")
    if summaries["S3"]["bytes"] != (64 * 7 + 64 * 9) * MIB:
        raise RuntimeError("S3 byte count mismatch")
    if summaries["S4"]["bytes"] != 10 * 100 * MIB:
        raise RuntimeError("S4 byte count mismatch")
    if not 5 * GIB <= summaries["S5"]["bytes"] < 5 * GIB + 5 * MIB:
        raise RuntimeError("S5 byte count outside target window")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("source", "build", "all", "verify"))
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT)
    parser.add_argument("--list-pages", type=int, default=20)
    parser.add_argument("--workers", type=int, default=12)
    parser.add_argument("--skip-decode", action="store_true")
    args = parser.parse_args()
    root = args.root.expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    if args.command in {"source", "all"}:
        selection = prepare_source(root, args.list_pages, args.workers)
    else:
        selection = json.loads(
            (root / "sources" / "snapshot-serengeti-s03-selection.json").read_text()
        )["images"]
    if args.command in {"build", "all"}:
        build_derived(root, selection)
    if args.command in {"build", "all", "verify"}:
        summaries = write_manifests(
            root, args.workers, not args.skip_decode, write=args.command != "verify"
        )
        verify_shape(summaries)
        print(
            json.dumps(
                {"root": str(root), "verified": True, "summaries": summaries},
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
