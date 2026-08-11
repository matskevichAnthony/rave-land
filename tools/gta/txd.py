"""Reader for GTA San Andreas RenderWare texture dictionaries (.txd).

Chunks follow the RenderWare binary stream layout (type, size, library version)
and nest; textures live in Texture Native chunks whose Direct3D 8 and Direct3D 9
variants share a header but disagree on two fields, see _read_raster.

The DXT decoder is spelled out here so the tool needs nothing but Pillow, which
is only ever asked to write the PNG.
"""

from __future__ import annotations

import argparse
import struct
import warnings
from collections import namedtuple
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

CHUNK_HEADER_FORMAT = "<III"
CHUNK_STRUCT = 0x01
CHUNK_TEXTURE_NATIVE = 0x15
CHUNK_TEXTURE_DICTIONARY = 0x16

NAME_FIELD_SIZE = 32

PLATFORM_D3D8 = 8
PLATFORM_D3D9 = 9

D3D9_HAS_ALPHA = 1 << 0
D3D9_IS_COMPRESSED = 1 << 3

RASTER_FORMAT_MASK = 0x0F00
RASTER_1555 = 0x0100
RASTER_565 = 0x0200
RASTER_4444 = 0x0300
RASTER_LUM8 = 0x0400
RASTER_8888 = 0x0500
RASTER_888 = 0x0600
RASTER_555 = 0x0A00
RASTER_PAL8 = 0x2000
RASTER_PAL4 = 0x4000

RASTER_NAMES = {
    RASTER_1555: "1555",
    RASTER_565: "565",
    RASTER_4444: "4444",
    RASTER_LUM8: "LUM8",
    RASTER_8888: "8888",
    RASTER_888: "888",
    RASTER_555: "555",
}

PALETTES = {RASTER_PAL4: ("PAL4", 32), RASTER_PAL8: ("PAL8", 256)}
PALETTE_ENTRY_SIZE = 4
PALETTE_INDEX_DEPTH = 8

DXT_VARIANT_BY_FOURCC = {b"DXT1": 1, b"DXT3": 3, b"DXT5": 5}
BLOCK_PIXELS = 4
BLOCK_TEXELS = BLOCK_PIXELS * BLOCK_PIXELS
COLOUR_INDEX_MASK = 0b11
ALPHA_INDEX_MASK = 0b111
NIBBLE_MASK = 0xF
NIBBLE_TO_BYTE = 0x11

BITS_PER_BYTE = 8
RGBA_STRIDE = 4
OPAQUE = 255
TRANSPARENT = 0


class TxdFormatError(Exception):
    """The byte stream does not match the RenderWare texture dictionary layout."""


class TxdDataWarning(UserWarning):
    """The layout holds, but the dictionary carries something unexpected."""


@dataclass
class Texture:
    name: str
    width: int
    height: int
    has_alpha: bool
    pixel_format: str
    rgba: bytes

    def save_png(self, path) -> None:
        """Write the texture as PNG, keeping an alpha channel only if it carries one."""
        image = Image.frombytes("RGBA", (self.width, self.height), self.rgba)
        if not self.has_alpha:
            image = image.convert("RGB")
        image.save(Path(path))


class _Reader:
    def __init__(self, data: bytes, source: str):
        self.data = data
        self.source = source
        self.offset = 0

    def unpack(self, layout: str) -> tuple:
        size = struct.calcsize(layout)
        values = struct.unpack_from(layout, self.data, self._advance(size, layout))
        return values

    def take(self, size: int, what: str) -> bytes:
        start = self._advance(size, what)
        return self.data[start:start + size]

    def name(self) -> str:
        return self.take(NAME_FIELD_SIZE, "name field").split(b"\0")[0].decode("latin-1")

    def _advance(self, size: int, what: str) -> int:
        if size < 0 or self.offset + size > len(self.data):
            raise TxdFormatError(
                f"{self.source}: reading {what} at offset {self.offset} needs {size} bytes, "
                f"only {len(self.data) - self.offset} left"
            )
        start = self.offset
        self.offset += size
        return start


def _enter_chunk(reader: _Reader, expected: int, where: str) -> int:
    """Read a chunk header of the expected type and return the offset past its body."""
    chunk_type, size, _library_version = reader.unpack(CHUNK_HEADER_FORMAT)
    if chunk_type != expected:
        raise TxdFormatError(f"{where}: expected chunk {expected:#04x}, got {chunk_type:#04x}")
    end = reader.offset + size
    if end > len(reader.data):
        raise TxdFormatError(
            f"{where}: chunk {expected:#04x} declares {size} bytes, "
            f"only {len(reader.data) - reader.offset} left"
        )
    return end


def _lerp(first: int, second: int, first_weight: int, second_weight: int) -> int:
    return (first * first_weight + second * second_weight) // (first_weight + second_weight)


def _mix(first: tuple, second: tuple, first_weight: int, second_weight: int) -> tuple:
    return tuple(_lerp(a, b, first_weight, second_weight) for a, b in zip(first, second))


def _rgb565(value: int) -> tuple:
    red, green, blue = (value >> 11) & 0x1F, (value >> 5) & 0x3F, value & 0x1F
    return (red << 3) | (red >> 2), (green << 2) | (green >> 4), (blue << 3) | (blue >> 2)


def _colour_table(low: int, high: int, punchthrough: bool) -> tuple:
    """Build the four block colours.

    DXT1 drops to three colours plus a transparent slot when its endpoints are
    stored in ascending order; DXT3 and DXT5 always interpolate four colours
    because they carry alpha separately.
    """
    first, second = _rgb565(low), _rgb565(high)
    if punchthrough and low <= high:
        return (
            first + (OPAQUE,),
            second + (OPAQUE,),
            _mix(first, second, 1, 1) + (OPAQUE,),
            (0, 0, 0, TRANSPARENT),
        )
    return (
        first + (OPAQUE,),
        second + (OPAQUE,),
        _mix(first, second, 2, 1) + (OPAQUE,),
        _mix(first, second, 1, 2) + (OPAQUE,),
    )


def _dxt1_texels(data: bytes, offset: int) -> list:
    low, high, indices = struct.unpack_from("<HHI", data, offset)
    colours = _colour_table(low, high, punchthrough=True)
    return [colours[(indices >> (2 * texel)) & COLOUR_INDEX_MASK] for texel in range(BLOCK_TEXELS)]


def _dxt3_texels(data: bytes, offset: int) -> list:
    alphas, low, high, indices = struct.unpack_from("<QHHI", data, offset)
    colours = _colour_table(low, high, punchthrough=False)
    texels = []
    for texel in range(BLOCK_TEXELS):
        red, green, blue, _ = colours[(indices >> (2 * texel)) & COLOUR_INDEX_MASK]
        alpha = (alphas >> (4 * texel)) & NIBBLE_MASK
        texels.append((red, green, blue, alpha * NIBBLE_TO_BYTE))
    return texels


def _alpha_table(low: int, high: int) -> tuple:
    if low > high:
        return (low, high) + tuple(_lerp(low, high, 7 - step, step) for step in range(1, 7))
    return (
        (low, high)
        + tuple(_lerp(low, high, 5 - step, step) for step in range(1, 5))
        + (TRANSPARENT, OPAQUE)
    )


def _dxt5_texels(data: bytes, offset: int) -> list:
    alpha_block, low, high, indices = struct.unpack_from("<QHHI", data, offset)
    alphas = _alpha_table(alpha_block & 0xFF, (alpha_block >> BITS_PER_BYTE) & 0xFF)
    alpha_indices = alpha_block >> (2 * BITS_PER_BYTE)
    colours = _colour_table(low, high, punchthrough=False)
    texels = []
    for texel in range(BLOCK_TEXELS):
        red, green, blue, _ = colours[(indices >> (2 * texel)) & COLOUR_INDEX_MASK]
        texels.append((red, green, blue, alphas[(alpha_indices >> (3 * texel)) & ALPHA_INDEX_MASK]))
    return texels


DxtVariant = namedtuple("DxtVariant", "block_bytes read_texels")
DXT_VARIANTS = {
    1: DxtVariant(8, _dxt1_texels),
    3: DxtVariant(16, _dxt3_texels),
    5: DxtVariant(16, _dxt5_texels),
}


def _blocks_across(pixels: int) -> int:
    return (pixels + BLOCK_PIXELS - 1) // BLOCK_PIXELS


def _dxt_surface_bytes(variant: int, width: int, height: int) -> int:
    return _blocks_across(width) * _blocks_across(height) * DXT_VARIANTS[variant].block_bytes


def _decode_dxt(variant: int, data: bytes, width: int, height: int) -> bytes:
    block_bytes, texels_of_block = DXT_VARIANTS[variant]
    across = _blocks_across(width)
    rgba = bytearray(width * height * RGBA_STRIDE)
    for block in range(across * _blocks_across(height)):
        left, top = (block % across) * BLOCK_PIXELS, (block // across) * BLOCK_PIXELS
        for texel, colour in enumerate(texels_of_block(data, block * block_bytes)):
            x, y = left + texel % BLOCK_PIXELS, top + texel // BLOCK_PIXELS
            if x < width and y < height:
                start = (y * width + x) * RGBA_STRIDE
                rgba[start:start + RGBA_STRIDE] = bytes(colour)
    return bytes(rgba)


def _expand(value: int, bits: int) -> int:
    """Stretch a channel of the given width to eight bits, keeping 0 and full scale exact."""
    return (value << (BITS_PER_BYTE - bits)) | (value >> (2 * bits - BITS_PER_BYTE))


def _texel_565(value: int) -> tuple:
    return _rgb565(value) + (OPAQUE,)


def _texel_1555(value: int) -> tuple:
    return (
        _expand((value >> 10) & 0x1F, 5),
        _expand((value >> 5) & 0x1F, 5),
        _expand(value & 0x1F, 5),
        OPAQUE if value & 0x8000 else TRANSPARENT,
    )


def _texel_555(value: int) -> tuple:
    return _texel_1555(value)[:3] + (OPAQUE,)


def _texel_4444(value: int) -> tuple:
    return (
        _expand((value >> 8) & NIBBLE_MASK, 4),
        _expand((value >> 4) & NIBBLE_MASK, 4),
        _expand(value & NIBBLE_MASK, 4),
        _expand((value >> 12) & NIBBLE_MASK, 4),
    )


TEXEL_READERS_16BIT = {
    RASTER_1555: _texel_1555,
    RASTER_565: _texel_565,
    RASTER_4444: _texel_4444,
    RASTER_555: _texel_555,
}


def _rgba_from_bgra(data: bytes, pixels: int, opaque: bool) -> bytes:
    """Swap the red and blue channels of 32-bit texels, which Direct3D stores as BGRA."""
    rgba = bytearray(data[:pixels * RGBA_STRIDE])
    rgba[0::RGBA_STRIDE] = data[2:pixels * RGBA_STRIDE:RGBA_STRIDE]
    rgba[2::RGBA_STRIDE] = data[0:pixels * RGBA_STRIDE:RGBA_STRIDE]
    if opaque:
        rgba[3::RGBA_STRIDE] = bytes([OPAQUE]) * pixels
    return bytes(rgba)


def _rgba_from_16bit(data: bytes, pixels: int, read_texel) -> bytes:
    values = struct.unpack_from(f"<{pixels}H", data)
    return b"".join(bytes(read_texel(value)) for value in values)


def _rgba_from_luminance(data: bytes, pixels: int) -> bytes:
    return b"".join(bytes((level, level, level, OPAQUE)) for level in data[:pixels])


def _decode_direct(base_format: int, data: bytes, pixels: int, where: str) -> bytes:
    if base_format in (RASTER_8888, RASTER_888):
        return _rgba_from_bgra(data, pixels, opaque=base_format == RASTER_888)
    if base_format in TEXEL_READERS_16BIT:
        return _rgba_from_16bit(data, pixels, TEXEL_READERS_16BIT[base_format])
    if base_format == RASTER_LUM8:
        return _rgba_from_luminance(data, pixels)
    raise TxdFormatError(f"{where}: unsupported raster format {base_format:#06x}")


def _decode_palettized(base_format: int, palette: bytes, data: bytes, pixels: int) -> bytes:
    entries = _rgba_from_bgra(palette, len(palette) // PALETTE_ENTRY_SIZE, base_format == RASTER_888)
    return b"".join(
        entries[index * RGBA_STRIDE:(index + 1) * RGBA_STRIDE] for index in data[:pixels]
    )


def _palette_bytes(raster_format: int) -> int:
    for flag, (_name, entries) in PALETTES.items():
        if raster_format & flag:
            return entries * PALETTE_ENTRY_SIZE
    return 0


def _dxt_variant(platform: int, native_format: int, native_flags: int, where: str) -> int | None:
    """Read the DXT number, stored plainly by Direct3D 8 and as a four-character code by Direct3D 9."""
    if platform == PLATFORM_D3D8:
        variant = native_flags
    elif native_flags & D3D9_IS_COMPRESSED:
        fourcc = struct.pack("<I", native_format)
        if fourcc not in DXT_VARIANT_BY_FOURCC:
            raise TxdFormatError(f"{where}: unsupported compressed format {fourcc!r}")
        variant = DXT_VARIANT_BY_FOURCC[fourcc]
    else:
        return None
    if variant and variant not in DXT_VARIANTS:
        raise TxdFormatError(f"{where}: unsupported DXT variant {variant}")
    return variant or None


def _format_label(raster_format: int, variant: int | None) -> str:
    if variant:
        return f"DXT{variant}"
    base = raster_format & RASTER_FORMAT_MASK
    names = [name for flag, (name, _entries) in PALETTES.items() if raster_format & flag]
    names.append(RASTER_NAMES.get(base, f"{base:#06x}"))
    return " ".join(names)


def _read_raster(reader: _Reader, where: str) -> Texture:
    platform, _filter_flags = reader.unpack("<II")
    if platform not in (PLATFORM_D3D8, PLATFORM_D3D9):
        raise TxdFormatError(f"{where}: unsupported platform {platform}")
    name = reader.name()
    _mask_name = reader.name()
    # Both platforms share this header but reuse two slots: Direct3D 9 stores a
    # D3DFORMAT plus a bit field, Direct3D 8 an alpha flag plus a DXT number.
    raster_format, native_format = reader.unpack("<II")
    width, height = reader.unpack("<HH")
    depth, level_count, _raster_type, native_flags = reader.unpack("<BBBB")
    where = f"{where} {name!r}"

    if not width or not height:
        raise TxdFormatError(f"{where}: degenerate size {width}x{height}")
    if not level_count:
        raise TxdFormatError(f"{where}: no mipmap levels")

    variant = _dxt_variant(platform, native_format, native_flags, where)
    if platform == PLATFORM_D3D8:
        has_alpha = bool(native_format)
    else:
        has_alpha = bool(native_flags & D3D9_HAS_ALPHA)

    palette = reader.take(_palette_bytes(raster_format), "palette")
    levels = []
    for _ in range(level_count):
        (level_bytes,) = reader.unpack("<I")
        levels.append(reader.take(level_bytes, "mipmap level"))

    expected = (
        _dxt_surface_bytes(variant, width, height)
        if variant
        else width * height * depth // BITS_PER_BYTE
    )
    if len(levels[0]) != expected:
        raise TxdFormatError(
            f"{where}: top mipmap holds {len(levels[0])} bytes, "
            f"{width}x{height} at {depth} bpp needs {expected}"
        )

    pixels = width * height
    base_format = raster_format & RASTER_FORMAT_MASK
    if variant:
        rgba = _decode_dxt(variant, levels[0], width, height)
    elif palette:
        if depth != PALETTE_INDEX_DEPTH:
            raise TxdFormatError(f"{where}: palettized texture at {depth} bpp is not supported")
        rgba = _decode_palettized(base_format, palette, levels[0], pixels)
    else:
        rgba = _decode_direct(base_format, levels[0], pixels, where)

    return Texture(
        name=name,
        width=width,
        height=height,
        has_alpha=has_alpha,
        pixel_format=_format_label(raster_format, variant),
        rgba=rgba,
    )


def _read_texture(reader: _Reader, where: str) -> Texture:
    native_end = _enter_chunk(reader, CHUNK_TEXTURE_NATIVE, where)
    struct_end = _enter_chunk(reader, CHUNK_STRUCT, where)
    texture = _read_raster(reader, where)
    if reader.offset != struct_end:
        raise TxdFormatError(
            f"{where}: texture {texture.name!r} leaves {struct_end - reader.offset} bytes "
            "of its struct unread"
        )
    reader.offset = native_end
    return texture


def load_txd(path) -> dict[str, Texture]:
    """Decode every texture of a RenderWare .txd, keyed by the name materials refer to."""
    path = Path(path)
    reader = _Reader(path.read_bytes(), path.name)
    dictionary_end = _enter_chunk(reader, CHUNK_TEXTURE_DICTIONARY, path.name)
    struct_end = _enter_chunk(reader, CHUNK_STRUCT, path.name)
    texture_count, _device_id = reader.unpack("<HH")
    reader.offset = struct_end

    textures: dict[str, Texture] = {}
    for index in range(texture_count):
        texture = _read_texture(reader, f"{path.name}[{index}]")
        if texture.name in textures:
            warnings.warn(
                f"{path.name}: texture {texture.name!r} appears more than once, keeping the first",
                TxdDataWarning,
            )
            continue
        textures[texture.name] = texture

    padding = reader.data[dictionary_end:]
    if padding.strip(b"\0"):
        warnings.warn(
            f"{path.name}: {len(padding)} bytes past the dictionary are not zero padding",
            TxdDataWarning,
        )
    return textures


def _print_list(textures: dict[str, Texture]) -> None:
    print(f"{'texture':24} {'size':>11}  {'format':12} alpha")
    for texture in sorted(textures.values(), key=lambda item: item.name.lower()):
        size = f"{texture.width}x{texture.height}"
        print(
            f"{texture.name:24} {size:>11}  {texture.pixel_format:12} "
            f"{'yes' if texture.has_alpha else 'no'}"
        )


def _extract(textures: dict[str, Texture], directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for texture in textures.values():
        target = directory / f"{texture.name}.png"
        texture.save_png(target)
        print(target)


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a GTA San Andreas RenderWare .txd")
    parser.add_argument("path", type=Path)
    parser.add_argument("--list", action="store_true", help="print one row per texture")
    parser.add_argument("--extract", type=Path, metavar="DIRECTORY", help="write every texture as PNG")
    arguments = parser.parse_args()
    textures = load_txd(arguments.path)
    if arguments.extract:
        _extract(textures, arguments.extract)
    if arguments.list or not arguments.extract:
        _print_list(textures)


if __name__ == "__main__":
    main()
