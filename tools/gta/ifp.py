"""Reader for GTA San Andreas IFP animation packages (version ANP3).

Layout was recovered empirically from ped.ifp and cross-checked against the
GTAMods wiki; see the constants below for the confirmed scales.
"""

from __future__ import annotations

import argparse
import math
import struct
import warnings
from dataclasses import dataclass
from pathlib import Path

MAGIC = b"ANP3"
HEADER_FORMAT = "<4sI24si"
SIZE_FIELD_END = 8
NAME_FIELD_SIZE = 24
ANIMATION_HEADER_FORMAT = "<iii"
BONE_HEADER_FORMAT = "<iii"
BONE_HEADER_SIZE = NAME_FIELD_SIZE + struct.calcsize(BONE_HEADER_FORMAT)

ROTATION_ONLY = 3
ROTATION_AND_TRANSLATION = 4
FRAME_INT16_COUNT = {ROTATION_ONLY: 5, ROTATION_AND_TRANSLATION: 8}

ROTATION_SCALE = 4096.0
TRANSLATION_SCALE = 1024.0
TIME_SCALE = 60.0

UNSET_BONE_ID = -1
QUATERNION_TOLERANCE = 1e-2
START_TIME_TOLERANCE = 1e-3


class IfpFormatError(Exception):
    """The byte stream does not match the ANP3 layout."""


class IfpDataWarning(UserWarning):
    """The layout holds, but a keyframe carries implausible values."""


@dataclass
class Keyframe:
    time: float
    rot: tuple
    pos: tuple | None


@dataclass
class BoneTrack:
    name: str
    bone_id: int
    frames: list[Keyframe]

    @property
    def has_translation(self) -> bool:
        return any(frame.pos is not None for frame in self.frames)


@dataclass
class Animation:
    name: str
    bones: list[BoneTrack]

    @property
    def duration(self) -> float:
        return max((track.frames[-1].time for track in self.bones if track.frames), default=0.0)

    @property
    def frame_count(self) -> int:
        return sum(len(track.frames) for track in self.bones)

    @property
    def has_translation(self) -> bool:
        return any(track.has_translation for track in self.bones)


class _Reader:
    def __init__(self, data: bytes, source: str):
        self.data = data
        self.source = source
        self.offset = 0

    def unpack(self, layout: str) -> tuple:
        size = struct.calcsize(layout)
        self.require(size, layout)
        values = struct.unpack_from(layout, self.data, self.offset)
        self.offset += size
        return values

    def name(self) -> str:
        self.require(NAME_FIELD_SIZE, "name field")
        field = self.data[self.offset:self.offset + NAME_FIELD_SIZE]
        self.offset += NAME_FIELD_SIZE
        return field.split(b"\0")[0].decode("latin-1")

    def require(self, size: int, what: str) -> None:
        if self.offset + size > len(self.data):
            raise IfpFormatError(
                f"{self.source}: reading {what} at offset {self.offset} needs {size} bytes, "
                f"only {len(self.data) - self.offset} left"
            )


def _unit_quaternion(raw: tuple, where: str) -> tuple:
    quaternion = tuple(component / ROTATION_SCALE for component in raw)
    length = math.hypot(*quaternion)
    if length == 0.0:
        raise IfpFormatError(f"{where}: zero-length quaternion {raw}")
    if abs(length - 1.0) > QUATERNION_TOLERANCE:
        warnings.warn(
            f"{where}: quaternion length {length:.5f} deviates from 1 by "
            f"{abs(length - 1.0):.5f} (raw {raw})",
            IfpDataWarning,
            stacklevel=2,
        )
    return tuple(component / length for component in quaternion)


def _read_frames(reader: _Reader, frame_type: int, count: int, where: str) -> list[Keyframe]:
    stride = FRAME_INT16_COUNT[frame_type]
    values = reader.unpack(f"<{stride * count}h")
    frames = []
    for start in range(0, len(values), stride):
        rot_x, rot_y, rot_z, rot_w, raw_time, *translation = values[start:start + stride]
        frames.append(
            Keyframe(
                time=raw_time / TIME_SCALE,
                rot=_unit_quaternion((rot_w, rot_x, rot_y, rot_z), where),
                pos=tuple(axis / TRANSLATION_SCALE for axis in translation) or None,
            )
        )
    return frames


def _check_timeline(frames: list[Keyframe], where: str) -> None:
    for previous, current in zip(frames, frames[1:]):
        if current.time <= previous.time:
            raise IfpFormatError(
                f"{where}: keyframe times must increase, got {previous.time} then {current.time}"
            )
    if frames and frames[0].time > START_TIME_TOLERANCE:
        warnings.warn(f"{where}: track starts at {frames[0].time:.3f}s, not 0", IfpDataWarning)


def _read_bone_track(reader: _Reader, animation_name: str) -> BoneTrack:
    name = reader.name()
    frame_type, frame_count, bone_id = reader.unpack(BONE_HEADER_FORMAT)
    where = f"{animation_name}/{name}"
    if frame_type not in FRAME_INT16_COUNT:
        raise IfpFormatError(f"{where}: unsupported frame type {frame_type}")
    if frame_count < 0:
        raise IfpFormatError(f"{where}: negative frame count {frame_count}")
    frames = _read_frames(reader, frame_type, frame_count, where)
    _check_timeline(frames, where)
    return BoneTrack(name=name, bone_id=bone_id, frames=frames)


def _read_animation(reader: _Reader) -> Animation:
    name = reader.name()
    bone_count, frame_bytes, compressed = reader.unpack(ANIMATION_HEADER_FORMAT)
    if not compressed:
        raise IfpFormatError(f"{name}: uncompressed ANP3 animations are not supported")
    start = reader.offset
    bones = [_read_bone_track(reader, name) for _ in range(bone_count)]
    frame_bytes_read = reader.offset - start - bone_count * BONE_HEADER_SIZE
    if frame_bytes_read != frame_bytes:
        raise IfpFormatError(
            f"{name}: header declares {frame_bytes} bytes of frame data, "
            f"{frame_bytes_read} were read"
        )
    return Animation(name=name, bones=bones)


def _check_bone_ids(animations: list[Animation]) -> None:
    id_by_name: dict[str, tuple[int, str]] = {}
    for animation in animations:
        for track in animation.bones:
            if track.bone_id == UNSET_BONE_ID:
                continue
            known_id, first_seen = id_by_name.setdefault(track.name, (track.bone_id, animation.name))
            if known_id != track.bone_id:
                raise IfpFormatError(
                    f"bone {track.name!r} has id {track.bone_id} in {animation.name} "
                    f"but id {known_id} in {first_seen}"
                )


def load_ifp(path) -> list[Animation]:
    """Parse an ANP3 .ifp file into animations with normalized quaternions."""
    path = Path(path)
    reader = _Reader(path.read_bytes(), path.name)
    magic, remaining_bytes, _package_name, animation_count = reader.unpack(HEADER_FORMAT)
    if magic != MAGIC:
        raise IfpFormatError(f"{path.name}: expected {MAGIC.decode()}, got {magic!r}")
    declared_end = SIZE_FIELD_END + remaining_bytes
    if declared_end > len(reader.data):
        raise IfpFormatError(
            f"{path.name}: header declares {remaining_bytes} bytes after the size field, "
            f"file holds {len(reader.data) - SIZE_FIELD_END}"
        )
    # A package taken out of an .img archive keeps the zero padding of its last sector.
    if reader.data[declared_end:].strip(b"\0"):
        raise IfpFormatError(
            f"{path.name}: {len(reader.data) - declared_end} bytes past the declared end "
            "are not zero padding"
        )
    if animation_count < 0:
        raise IfpFormatError(f"{path.name}: negative animation count {animation_count}")

    animations = [_read_animation(reader) for _ in range(animation_count)]
    if reader.offset != declared_end:
        raise IfpFormatError(
            f"{path.name}: {declared_end - reader.offset} trailing bytes after "
            f"{animation_count} animations"
        )
    _check_bone_ids(animations)
    return animations


def _print_list(animations: list[Animation]) -> None:
    print(f"{'animation':28} {'bones':>5} {'frames':>7} {'seconds':>8}  translation")
    for animation in sorted(animations, key=lambda item: item.name.lower()):
        print(
            f"{animation.name:28} {len(animation.bones):5d} {animation.frame_count:7d} "
            f"{animation.duration:8.2f}  {'yes' if animation.has_translation else 'no'}"
        )


def _print_check(path: Path) -> None:
    with warnings.catch_warnings(record=True) as anomalies:
        warnings.simplefilter("always", IfpDataWarning)
        animations = load_ifp(path)
    tracks = [track for animation in animations for track in animation.bones]
    frames = sum(len(track.frames) for track in tracks)
    print(f"{path.name}: parsed to the last byte")
    print(f"animations {len(animations)}, tracks {len(tracks)}, keyframes {frames}")
    print(f"bone names {len({track.name for track in tracks})}, ids consistent per name")
    print(f"anomalies {len(anomalies)}")
    for anomaly in anomalies:
        print(f"  {anomaly.message}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a GTA San Andreas ANP3 .ifp package")
    parser.add_argument("path", type=Path)
    parser.add_argument("--list", action="store_true", help="print one row per animation")
    parser.add_argument("--check", action="store_true", help="print validation counters")
    arguments = parser.parse_args()
    if arguments.check:
        _print_check(arguments.path)
    if arguments.list or not arguments.check:
        _print_list(load_ifp(arguments.path))


if __name__ == "__main__":
    main()
