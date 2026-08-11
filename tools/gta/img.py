"""Reader for GTA San Andreas IMG version 2 archives.

The archive opens with "VER2" and an entry count, then a directory of fixed
32-byte records; every offset and size in that directory counts 2048-byte
sectors rather than bytes.
"""

from __future__ import annotations

import argparse
import struct
import warnings
from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path

MAGIC = b"VER2"
HEADER_FORMAT = "<4sI"
ENTRY_FORMAT = "<IHH24s"
ENTRY_SIZE = struct.calcsize(ENTRY_FORMAT)
SECTOR_SIZE = 2048


class ImgFormatError(Exception):
    """The byte stream does not match the version 2 archive layout."""


class ImgDataWarning(UserWarning):
    """The layout holds, but the directory describes something implausible."""


@dataclass
class Entry:
    name: str
    offset: int
    size: int
    archive: Path

    def read(self) -> bytes:
        with self.archive.open("rb") as stream:
            stream.seek(self.offset)
            return stream.read(self.size)


def _read_entry(record: bytes, archive: Path, where: str) -> Entry:
    offset, streaming_sectors, archive_sectors, name_field = struct.unpack(ENTRY_FORMAT, record)
    # San Andreas records the length in streamingSize and leaves sizeInArchive
    # zero; some archive tools do the reverse, so accept whichever is set.
    sectors = streaming_sectors or archive_sectors
    if not sectors:
        raise ImgFormatError(f"{where}: entry declares no sectors")
    name = name_field.split(b"\0")[0].decode("latin-1")
    if not name:
        raise ImgFormatError(f"{where}: entry has an empty name")
    return Entry(
        name=name,
        offset=offset * SECTOR_SIZE,
        size=sectors * SECTOR_SIZE,
        archive=archive,
    )


def _check_bounds(entries: list[Entry], directory_end: int, archive_size: int, source: str) -> None:
    for entry in entries:
        if entry.offset < directory_end:
            raise ImgFormatError(
                f"{source}: {entry.name} starts at {entry.offset}, inside the {directory_end}-byte directory"
            )
        if entry.offset + entry.size > archive_size:
            warnings.warn(
                f"{source}: {entry.name} runs to {entry.offset + entry.size}, "
                f"past the {archive_size}-byte archive",
                ImgDataWarning,
            )
    for previous, current in zip(entries, entries[1:]):
        if current.offset < previous.offset + previous.size:
            warnings.warn(
                f"{source}: {current.name} overlaps {previous.name}",
                ImgDataWarning,
            )


def load_img(path) -> list[Entry]:
    """Read the directory of a version 2 .img archive, in stored order."""
    path = Path(path)
    with path.open("rb") as stream:
        magic, entry_count = struct.unpack(HEADER_FORMAT, stream.read(struct.calcsize(HEADER_FORMAT)))
        if magic != MAGIC:
            raise ImgFormatError(f"{path.name}: expected {MAGIC.decode()}, got {magic!r}")
        directory = stream.read(entry_count * ENTRY_SIZE)
    if len(directory) != entry_count * ENTRY_SIZE:
        raise ImgFormatError(
            f"{path.name}: directory of {entry_count} entries needs "
            f"{entry_count * ENTRY_SIZE} bytes, file holds {len(directory)}"
        )

    entries = [
        _read_entry(directory[start:start + ENTRY_SIZE], path, f"{path.name}[{start // ENTRY_SIZE}]")
        for start in range(0, len(directory), ENTRY_SIZE)
    ]
    _check_bounds(
        sorted(entries, key=lambda entry: entry.offset),
        struct.calcsize(HEADER_FORMAT) + len(directory),
        path.stat().st_size,
        path.name,
    )
    return entries


def _selected(entries: list[Entry], mask: str | None) -> list[Entry]:
    if not mask:
        return entries
    return [entry for entry in entries if fnmatch(entry.name.lower(), mask.lower())]


def _print_list(entries: list[Entry]) -> None:
    print(f"{'name':28} {'offset':>10} {'bytes':>10}")
    for entry in sorted(entries, key=lambda item: item.name.lower()):
        print(f"{entry.name:28} {entry.offset:10d} {entry.size:10d}")


def _extract(entries: list[Entry], directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        target = directory / entry.name
        target.write_bytes(entry.read())
        print(target)


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a GTA San Andreas version 2 .img archive")
    parser.add_argument("path", type=Path)
    parser.add_argument("--list", action="store_true", help="print one row per entry")
    parser.add_argument("--extract", type=Path, metavar="DIRECTORY", help="write entries as files")
    parser.add_argument("--only", metavar="MASK", help="keep entries matching a glob, e.g. '*.dff'")
    arguments = parser.parse_args()
    entries = _selected(load_img(arguments.path), arguments.only)
    if arguments.extract:
        _extract(entries, arguments.extract)
    if arguments.list or not arguments.extract:
        _print_list(entries)


if __name__ == "__main__":
    main()
