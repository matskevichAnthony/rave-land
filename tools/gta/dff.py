"""Reader for RenderWare clumps as GTA San Andreas ships them (.dff models).

Layout follows the RenderWare binary stream spec on gtamods.com and was checked
against the 296 stock ped models: every chunk is consumed to its declared end,
so a wrong field width shows up immediately as a size mismatch.

The two things worth having here are the skin plugin (four bone indices and
weights per vertex plus one inverse bind matrix per bone) and the frame list,
whose local matrices are the exact rest skeleton the .ifp animations rotate.

Coordinates are metres in a Y-up, +Z-forward, +X-left model space. Frame
rotations are stored row-major with the rows holding the basis vectors, i.e.
transposed relative to the column-vector convention used here.
"""

from __future__ import annotations

import argparse
import struct
from dataclasses import dataclass
from pathlib import Path

CHUNK_HEADER_FORMAT = "<III"
CHUNK_HEADER_SIZE = struct.calcsize(CHUNK_HEADER_FORMAT)

STRUCT = 0x01
STRING = 0x02
EXTENSION = 0x03
TEXTURE = 0x06
MATERIAL = 0x07
MATERIAL_LIST = 0x08
FRAME_LIST = 0x0E
GEOMETRY = 0x0F
CLUMP = 0x10
ATOMIC = 0x14
GEOMETRY_LIST = 0x1A
SKIN_PLUGIN = 0x0116
HANIM_PLUGIN = 0x011E
BIN_MESH_PLUGIN = 0x050E
FRAME_NAME = 0x0253F2FE

GEOMETRY_IS_TEXTURED = 0x0004
GEOMETRY_IS_PRELIT = 0x0008
GEOMETRY_IS_TEXTURED2 = 0x0080
GEOMETRY_IS_NATIVE = 0x0100
GEOMETRY_UV_SET_SHIFT = 16
GEOMETRY_UV_SET_MASK = 0xFF

TRIANGLE_LIST = 0
TRIANGLE_STRIP = 1

WEIGHTS_PER_VERTEX = 4
FRAME_STRUCT_FORMAT = "<9f3fiI"
# version, own bone id, bone count, then two flag words before the bone table.
HANIM_HIERARCHY_OFFSET = 20
NO_PARENT = -1
NO_BONE = -1

# Chunks written before RW 3.4 carry surface properties inside the geometry
# struct, and materials gained theirs after 3.0.4; both file versions still
# turn up in modder packs, so the reader branches on the declared library.
SURFACE_PROPERTIES_IN_GEOMETRY_BEFORE = 0x34000
SURFACE_PROPERTIES_IN_MATERIAL_AFTER = 0x30400
NEW_LIBRARY_ID_MASK = 0xFFFF0000


class DffFormatError(Exception):
    """The byte stream does not match the RenderWare clump layout."""


@dataclass
class Chunk:
    kind: int
    version: int
    body: bytes


@dataclass
class Frame:
    """One node of the model hierarchy: a local transform plus its parent."""
    name: str
    rotation: tuple
    position: tuple
    parent: int
    bone_id: int
    hierarchy: tuple


@dataclass
class Material:
    color: tuple
    texture: str | None
    ambient: float
    specular: float
    diffuse: float


@dataclass
class Skin:
    bone_indices: list
    bone_weights: list
    inverse_bind_matrices: list


@dataclass
class Geometry:
    vertices: list
    normals: list
    uvs: list
    triangles: list
    materials: list
    skin: Skin | None


@dataclass
class Atomic:
    frame: int
    geometry: int


@dataclass
class Clump:
    frames: list
    geometries: list
    atomics: list

    @property
    def bone_order(self) -> tuple:
        """Bone ids in skin-matrix order, taken from the HAnim hierarchy."""
        return next((frame.hierarchy for frame in self.frames if frame.hierarchy), ())

    @property
    def bones(self) -> list:
        """Frames carrying a HAnim bone id, parents remapped to bone ids."""
        bone_of_frame = {index: frame.bone_id for index, frame in enumerate(self.frames)
                         if frame.bone_id != NO_BONE}
        skeleton = []
        for index, frame in enumerate(self.frames):
            if frame.bone_id == NO_BONE:
                continue
            parent = frame.parent
            while parent != NO_PARENT and parent not in bone_of_frame:
                parent = self.frames[parent].parent
            skeleton.append((frame.bone_id, frame.name,
                             bone_of_frame.get(parent), frame.position))
        return skeleton


def load_dff(path) -> Clump:
    """Parse a RenderWare .dff into frames, geometries and atomics."""
    path = Path(path)
    data = path.read_bytes()
    clump = _next_chunk(data, 0, path.name)
    if clump.kind != CLUMP:
        raise DffFormatError(f"{path.name}: expected a clump, got chunk {clump.kind:#x}")
    # Files pulled out of an .img keep the sector padding they were stored with.
    padding = data[CHUNK_HEADER_SIZE + len(clump.body):]
    if padding.strip(b"\0"):
        raise DffFormatError(f"{path.name}: {len(padding)} non-zero bytes after the clump")
    return _read_clump(clump, path.name)


def _next_chunk(data: bytes, offset: int, source: str) -> Chunk:
    if offset + CHUNK_HEADER_SIZE > len(data):
        raise DffFormatError(f"{source}: chunk header at {offset} runs past the end")
    kind, size, library_id = struct.unpack_from(CHUNK_HEADER_FORMAT, data, offset)
    body = offset + CHUNK_HEADER_SIZE
    if body + size > len(data):
        raise DffFormatError(
            f"{source}: chunk {kind:#x} at {offset} declares {size} bytes, "
            f"only {len(data) - body} left"
        )
    return Chunk(kind, _library_version(library_id), data[body:body + size])


def _library_version(library_id: int) -> int:
    if library_id & NEW_LIBRARY_ID_MASK:
        return ((library_id >> 14) & 0x3FF00) + 0x30000
    return library_id << 8


def _children(chunk: Chunk, source: str) -> list:
    children = []
    offset = 0
    while offset < len(chunk.body):
        child = _next_chunk(chunk.body, offset, source)
        children.append(child)
        offset += CHUNK_HEADER_SIZE + len(child.body)
    return children


def _named(children: list, kind: int) -> Chunk | None:
    return next((child for child in children if child.kind == kind), None)


def _required(children: list, kind: int, source: str, what: str) -> Chunk:
    chunk = _named(children, kind)
    if chunk is None:
        raise DffFormatError(f"{source}: {what} has no chunk {kind:#x}")
    return chunk


def _string(chunk: Chunk) -> str:
    return chunk.body.split(b"\0")[0].decode("latin-1")


class _Cursor:
    """Sequential reader over a chunk body that refuses to overrun it."""

    def __init__(self, body: bytes, where: str):
        self.body = body
        self.where = where
        self.offset = 0

    def unpack(self, layout: str) -> tuple:
        size = struct.calcsize(layout)
        if self.offset + size > len(self.body):
            raise DffFormatError(
                f"{self.where}: reading {layout} at {self.offset} needs {size} bytes, "
                f"only {len(self.body) - self.offset} left"
            )
        values = struct.unpack_from(layout, self.body, self.offset)
        self.offset += size
        return values

    def vectors(self, count: int, width: int) -> list:
        flat = self.unpack(f"<{count * width}f")
        return [flat[start:start + width] for start in range(0, len(flat), width)]

    def skip(self, size: int) -> None:
        if self.offset + size > len(self.body):
            raise DffFormatError(f"{self.where}: skipping {size} bytes at {self.offset} overruns")
        self.offset += size

    def expect_end(self) -> None:
        if self.offset != len(self.body):
            raise DffFormatError(
                f"{self.where}: {len(self.body) - self.offset} bytes left after parsing"
            )


def _read_clump(chunk: Chunk, source: str) -> Clump:
    children = _children(chunk, source)
    frames = _read_frame_list(_required(children, FRAME_LIST, source, "clump"), source)
    geometry_list = _required(children, GEOMETRY_LIST, source, "clump")
    geometries = [_read_geometry(child, source)
                  for child in _children(geometry_list, source) if child.kind == GEOMETRY]
    atomics = [_read_atomic(child, source) for child in children if child.kind == ATOMIC]
    for atomic in atomics:
        if not 0 <= atomic.frame < len(frames):
            raise DffFormatError(f"{source}: atomic points at frame {atomic.frame}")
        if not 0 <= atomic.geometry < len(geometries):
            raise DffFormatError(f"{source}: atomic points at geometry {atomic.geometry}")
    return Clump(frames=frames, geometries=geometries, atomics=atomics)


def _read_frame_list(chunk: Chunk, source: str) -> list:
    children = _children(chunk, source)
    cursor = _Cursor(_required(children, STRUCT, source, "frame list").body, f"{source}/frames")
    count, = cursor.unpack("<I")
    placements = [cursor.unpack(FRAME_STRUCT_FORMAT) for _ in range(count)]
    cursor.expect_end()

    extensions = [child for child in children if child.kind == EXTENSION]
    if len(extensions) != count:
        raise DffFormatError(
            f"{source}: {count} frames but {len(extensions)} frame extensions"
        )
    frames = []
    for index, (placement, extension) in enumerate(zip(placements, extensions)):
        parts = _children(extension, source)
        name_chunk = _named(parts, FRAME_NAME)
        hanim = _named(parts, HANIM_PLUGIN)
        parent = placement[12]
        if parent >= index:
            raise DffFormatError(f"{source}: frame {index} claims parent {parent}")
        frames.append(Frame(
            name=_string(name_chunk).strip() if name_chunk else "",
            rotation=placement[0:9],
            position=placement[9:12],
            parent=parent,
            bone_id=struct.unpack_from("<i", hanim.body, 4)[0] if hanim else NO_BONE,
            hierarchy=_read_hierarchy(hanim) if hanim else (),
        ))
    return frames


def _read_hierarchy(chunk: Chunk) -> tuple:
    """Bone ids in the order the skin plugin indexes its matrices by."""
    _version, _bone_id, count = struct.unpack_from("<3i", chunk.body)
    if not count:
        return ()
    entries = struct.unpack_from(f"<{3 * count}i", chunk.body, HANIM_HIERARCHY_OFFSET)
    return entries[0::3]


def _read_atomic(chunk: Chunk, source: str) -> Atomic:
    frame, geometry = struct.unpack_from("<II", _required(
        _children(chunk, source), STRUCT, source, "atomic").body)
    return Atomic(frame=frame, geometry=geometry)


def _read_geometry(chunk: Chunk, source: str) -> Geometry:
    children = _children(chunk, source)
    cursor = _Cursor(_required(children, STRUCT, source, "geometry").body, f"{source}/geometry")
    fmt, triangle_count, vertex_count, morph_count = cursor.unpack("<IIII")
    if chunk.version < SURFACE_PROPERTIES_IN_GEOMETRY_BEFORE:
        cursor.unpack("<3f")
    if fmt & GEOMETRY_IS_NATIVE:
        raise DffFormatError(f"{source}: native (platform-specific) geometry is not supported")

    if fmt & GEOMETRY_IS_PRELIT:
        # Baked scene lighting for map props; peds have none and the game
        # relights them anyway, so the colours are read past, not kept.
        cursor.skip(4 * vertex_count)
    uv_sets = _uv_set_count(fmt)
    # Only the first set is kept: where SA uses a second it is an environment
    # map, which the glTF material has no slot for.
    uvs = cursor.vectors(vertex_count, 2) if uv_sets else []
    cursor.skip(8 * vertex_count * max(uv_sets - 1, 0))
    listed = [cursor.unpack("<4H") for _ in range(triangle_count)]

    vertices: list = []
    normals: list = []
    for morph in range(morph_count):
        cursor.unpack("<4f")
        has_vertices, has_normals = cursor.unpack("<II")
        morph_vertices = cursor.vectors(vertex_count, 3) if has_vertices else []
        morph_normals = cursor.vectors(vertex_count, 3) if has_normals else []
        # Only the base morph target is the model; the rest are blend shapes.
        if morph == 0:
            vertices, normals = morph_vertices, morph_normals
    cursor.expect_end()
    if not vertices:
        raise DffFormatError(f"{source}: geometry carries no vertex positions")

    materials = _read_material_list(
        _required(children, MATERIAL_LIST, source, "geometry"), source)
    extension = _children(_required(children, EXTENSION, source, "geometry"), source)
    bin_mesh = _named(extension, BIN_MESH_PLUGIN)
    triangles = (_read_bin_mesh(bin_mesh, source) if bin_mesh
                 else [(one, two, three) + (material,)
                       for two, one, material, three in listed])
    _check_indices(triangles, vertex_count, len(materials), source)

    skin_chunk = _named(extension, SKIN_PLUGIN)
    return Geometry(
        vertices=vertices,
        normals=normals,
        uvs=uvs,
        triangles=triangles,
        materials=materials,
        skin=_read_skin(skin_chunk, vertex_count, source) if skin_chunk else None,
    )


def _uv_set_count(fmt: int) -> int:
    declared = (fmt >> GEOMETRY_UV_SET_SHIFT) & GEOMETRY_UV_SET_MASK
    if declared:
        return declared
    if fmt & GEOMETRY_IS_TEXTURED2:
        return 2
    return 1 if fmt & GEOMETRY_IS_TEXTURED else 0


def _read_bin_mesh(chunk: Chunk, source: str) -> list:
    cursor = _Cursor(chunk.body, f"{source}/binmesh")
    flags, mesh_count, _total_indices = cursor.unpack("<III")
    if flags not in (TRIANGLE_LIST, TRIANGLE_STRIP):
        raise DffFormatError(f"{source}: unknown bin mesh flags {flags:#x}")
    triangles = []
    for _ in range(mesh_count):
        index_count, material = cursor.unpack("<Ii")
        indices = cursor.unpack(f"<{index_count}I")
        faces = _strip_faces(indices) if flags == TRIANGLE_STRIP else _list_faces(indices)
        triangles += [face + (material,) for face in faces]
    cursor.expect_end()
    return triangles


def _list_faces(indices: tuple) -> list:
    return [indices[start:start + 3] for start in range(0, len(indices) - 2, 3)]


def _strip_faces(indices: tuple) -> list:
    """Unroll a triangle strip, dropping the degenerate triangles that stitch it."""
    faces = []
    for start in range(len(indices) - 2):
        a, b, c = indices[start:start + 3]
        if a == b or b == c or a == c:
            continue
        faces.append((a, c, b) if start % 2 else (a, b, c))
    return faces


def _check_indices(triangles: list, vertex_count: int, material_count: int, source: str) -> None:
    for a, b, c, material in triangles:
        if max(a, b, c) >= vertex_count:
            raise DffFormatError(f"{source}: triangle index {max(a, b, c)} of {vertex_count}")
        if not 0 <= material < material_count:
            raise DffFormatError(f"{source}: triangle names material {material}")


def _read_material_list(chunk: Chunk, source: str) -> list:
    children = _children(chunk, source)
    cursor = _Cursor(_required(children, STRUCT, source, "material list").body,
                     f"{source}/materials")
    count, = cursor.unpack("<I")
    references = cursor.unpack(f"<{count}i")
    cursor.expect_end()

    # A non-negative entry reuses a material already listed, and only the rest
    # have a chunk of their own, handed out in order.
    defined = iter(child for child in children if child.kind == MATERIAL)
    materials: list = []
    for reference in references:
        materials.append(materials[reference] if reference >= 0
                         else _read_material(next(defined), source))
    return materials


def _read_material(chunk: Chunk, source: str) -> Material:
    children = _children(chunk, source)
    cursor = _Cursor(_required(children, STRUCT, source, "material").body, f"{source}/material")
    cursor.unpack("<I")
    color = cursor.unpack("<4B")
    cursor.unpack("<Ii")
    lighting = (cursor.unpack("<3f") if chunk.version > SURFACE_PROPERTIES_IN_MATERIAL_AFTER
                else (1.0, 1.0, 1.0))
    cursor.expect_end()

    texture_chunk = _named(children, TEXTURE)
    texture = None
    if texture_chunk is not None:
        names = [child for child in _children(texture_chunk, source) if child.kind == STRING]
        texture = _string(names[0]) if names else None
    return Material(color=tuple(channel / 255.0 for channel in color),
                    texture=texture or None,
                    ambient=lighting[0], specular=lighting[1], diffuse=lighting[2])


def _read_skin(chunk: Chunk, vertex_count: int, source: str) -> Skin:
    cursor = _Cursor(chunk.body, f"{source}/skin")
    bone_count, used_bone_count, _weights_per_vertex, _padding = cursor.unpack("<4B")
    cursor.skip(used_bone_count)
    indices = [cursor.unpack(f"<{WEIGHTS_PER_VERTEX}B") for _ in range(vertex_count)]
    weights = [cursor.unpack(f"<{WEIGHTS_PER_VERTEX}f") for _ in range(vertex_count)]
    matrices = []
    for _ in range(bone_count):
        # Before the used-bone list existed each matrix was prefixed by its
        # bone index; the list replaced it.
        if not used_bone_count:
            cursor.skip(4)
        matrices.append(_matrix_from_columns(cursor.unpack("<16f")))
    if max((max(vertex) for vertex in indices), default=0) >= bone_count:
        raise DffFormatError(f"{source}: skin weight names a bone outside {bone_count}")
    return Skin(bone_indices=indices, bone_weights=weights, inverse_bind_matrices=matrices)


def _matrix_from_columns(values: tuple) -> tuple:
    """Column-major 4x4 as stored -> rows of a column-vector matrix."""
    return tuple(tuple(values[column * 4 + row] for column in range(4)) for row in range(3)) \
        + ((0.0, 0.0, 0.0, 1.0),)


def _print_check(paths: list) -> None:
    print(f"{'model':24} {'frames':>6} {'bones':>5} {'verts':>6} {'tris':>6} "
          f"{'mats':>4}  textures")
    failures = []
    for path in paths:
        try:
            clump = load_dff(path)
        except DffFormatError as failure:
            failures.append(f"{path.name}: {failure}")
            continue
        vertices = sum(len(geometry.vertices) for geometry in clump.geometries)
        triangles = sum(len(geometry.triangles) for geometry in clump.geometries)
        materials = [material for geometry in clump.geometries
                     for material in geometry.materials]
        textures = sorted({material.texture for material in materials if material.texture})
        print(f"{path.name:24} {len(clump.frames):6d} {len(clump.bones):5d} {vertices:6d} "
              f"{triangles:6d} {len(materials):4d}  {' '.join(textures)}")
    for failure in failures:
        print("FAILED", failure)
    print(f"parsed {len(paths) - len(failures)}/{len(paths)}")


def _print_skeleton(path: Path) -> None:
    clump = load_dff(path)
    print(f"# rest skeleton of {path.name}, offsets in metres, parent frame axes")
    for bone_id, name, parent, offset in clump.bones:
        formatted = ", ".join(f"{axis:.4f}" for axis in offset)
        print(f"{bone_id:5d} {name:20} {str(parent):>5}  ({formatted})")


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a RenderWare .dff model")
    parser.add_argument("paths", type=Path, nargs="+")
    parser.add_argument("--skeleton", action="store_true",
                        help="print the bone hierarchy of the first model")
    arguments = parser.parse_args()
    if arguments.skeleton:
        _print_skeleton(arguments.paths[0])
    else:
        _print_check(arguments.paths)


if __name__ == "__main__":
    main()
