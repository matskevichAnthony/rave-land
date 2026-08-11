"""Rest skeleton plus irregular quaternion tracks -> BVH file.

Source agnostic: a mocap adapter (ifp2bvh today, FBX or CMU later) parses its
own format into a Joint tree and keyframes in metres and Z-up. Everything on
the BVH side lives here: resampling to a constant frame rate, the ZXY channel
order, the centimetres retarget.py expects, the Y-up axes Blender's importer
assumes.
"""
import math
from dataclasses import dataclass, field

CENTIMETRES_PER_METRE = 100.0
ROTATION_CHANNELS = ('Zrotation', 'Xrotation', 'Yrotation')
POSITION_CHANNELS = ('Xposition', 'Yposition', 'Zposition')
IDENTITY_ROTATION = (1.0, 0.0, 0.0, 0.0)
SLERP_LINEAR_LIMIT = 0.9995
INDENT = '  '

# Blender imports BVH as -Z forward / Y up, so the skeleton is handed over
# turned a quarter turn back around X. Turning a tree rigidly touches nothing
# but its root, hence one quaternion and one vector swizzle rather than a pass
# over every joint.
_HALF = math.sqrt(0.5)
Z_UP_TO_Y_UP = (_HALF, -_HALF, 0.0, 0.0)


@dataclass
class Joint:
    """Rest-pose node: offset from the parent joint, in metres, parent frame."""
    name: str
    offset: tuple
    children: list = field(default_factory=list)
    tip: tuple = None


def write_bvh(path, root, tracks, fps):
    """Resample tracks onto a constant frame rate and write them as BVH.

    tracks maps joint name to a list of (time, quaternion wxyz, position or
    None) in metres. Only the root joint's positions become channels, BVH
    offers none for the rest.
    """
    joints = list(_depth_first(root))
    unknown = sorted(set(tracks) - {joint.name for joint in joints})
    if unknown:
        raise ValueError(f'tracks for joints missing from the skeleton: {unknown}')

    duration = max((keys[-1][0] for keys in tracks.values() if keys), default=0.0)
    times = [index / fps for index in range(round(duration * fps) + 1)]
    rotations = {}
    for joint in joints:
        keys = [(time, rot) for time, rot, _ in tracks.get(joint.name, [])]
        # A joint the source never animates simply stays aligned with its parent.
        rotations[joint.name] = (_resample(keys, times, _slerp) if keys
                                 else [IDENTITY_ROTATION] * len(times))
    rotations[root.name] = [_multiply(Z_UP_TO_Y_UP, rot) for rot in rotations[root.name]]

    # BVH position channels are absolute and readers subtract the root OFFSET
    # back out of them, so the root's rest position has to be folded in here or
    # it is lost.
    placed = [(time, _add(root.offset, pos)) for time, _, pos in tracks.get(root.name, []) if pos]
    positions = _resample(placed, times, _lerp) if placed else [root.offset] * len(times)

    lines = ['HIERARCHY'] + _hierarchy_lines(root, is_root=True, depth=0)
    lines += ['MOTION', f'Frames: {len(times)}', f'Frame Time: {1.0 / fps:.6f}']
    for index in range(len(times)):
        values = list(_to_bvh_axes(positions[index]))
        for joint in joints:
            values += _zxy_degrees(rotations[joint.name][index])
        lines.append(' '.join(f'{value:.6f}' for value in values))
    with open(path, 'w') as bvh:
        bvh.write('\n'.join(lines) + '\n')
    return len(times)


def _depth_first(joint):
    yield joint
    for child in joint.children:
        yield from _depth_first(child)


def _hierarchy_lines(joint, is_root, depth):
    pad = INDENT * depth
    channels = (POSITION_CHANNELS + ROTATION_CHANNELS) if is_root else ROTATION_CHANNELS
    offset = _to_bvh_axes(joint.offset) if is_root else _centimetres(joint.offset)
    lines = [f'{pad}{"ROOT" if is_root else "JOINT"} {joint.name}',
             f'{pad}{{',
             f'{pad}{INDENT}{_offset_line(offset)}',
             f'{pad}{INDENT}CHANNELS {len(channels)} {" ".join(channels)}']
    for child in joint.children:
        lines += _hierarchy_lines(child, is_root=False, depth=depth + 1)
    if not joint.children:
        if joint.tip is None:
            raise ValueError(f'leaf joint {joint.name} needs a tip offset for its End Site')
        lines += [f'{pad}{INDENT}End Site',
                  f'{pad}{INDENT}{{',
                  f'{pad}{INDENT * 2}{_offset_line(_centimetres(joint.tip))}',
                  f'{pad}{INDENT}}}']
    return lines + [f'{pad}}}']


def _offset_line(offset):
    return 'OFFSET ' + ' '.join(f'{value:.6f}' for value in offset)


def _centimetres(vector):
    return tuple(value * CENTIMETRES_PER_METRE for value in vector)


def _to_bvh_axes(vector):
    """Swap axes on top of the unit change. Only world-space values need this:
    a local offset rides along with the frame its parent's rotation defines."""
    x, y, z = _centimetres(vector)
    return x, z, -y


def _resample(keys, times, blend):
    sampled = []
    index = 0
    for time in times:
        while index + 1 < len(keys) and keys[index + 1][0] <= time:
            index += 1
        key_time, value = keys[index]
        if index + 1 == len(keys):
            sampled.append(value)
            continue
        next_time, following = keys[index + 1]
        ratio = min(max((time - key_time) / (next_time - key_time), 0.0), 1.0)
        sampled.append(blend(value, following, ratio))
    return sampled


def _add(left, right):
    return tuple(a + b for a, b in zip(left, right))


def _lerp(start, end, ratio):
    return tuple(a + (b - a) * ratio for a, b in zip(start, end))


def _slerp(start, end, ratio):
    dot = sum(a * b for a, b in zip(start, end))
    if dot < 0.0:
        end, dot = tuple(-value for value in end), -dot
    if dot > SLERP_LINEAR_LIMIT:
        return _normalized(_lerp(start, end, ratio))
    angle = math.acos(dot)
    sine = math.sin(angle)
    weights = (math.sin((1.0 - ratio) * angle) / sine, math.sin(ratio * angle) / sine)
    return tuple(weights[0] * a + weights[1] * b for a, b in zip(start, end))


def _normalized(quaternion):
    length = math.sqrt(sum(value * value for value in quaternion))
    return tuple(value / length for value in quaternion)


def _multiply(left, right):
    lw, lx, ly, lz = left
    rw, rx, ry, rz = right
    return (lw * rw - lx * rx - ly * ry - lz * rz,
            lw * rx + lx * rw + ly * rz - lz * ry,
            lw * ry - lx * rz + ly * rw + lz * rx,
            lw * rz + lx * ry - ly * rx + lz * rw)


def _zxy_degrees(quaternion):
    """Euler angles matching ROTATION_CHANNELS, i.e. the rotation Rz @ Rx @ Ry."""
    w, x, y, z = quaternion
    around_x = math.asin(min(max(2.0 * (y * z + w * x), -1.0), 1.0))
    around_y = math.atan2(-2.0 * (x * z - w * y), 1.0 - 2.0 * (x * x + y * y))
    around_z = math.atan2(-2.0 * (x * y - w * z), 1.0 - 2.0 * (x * x + z * z))
    return [math.degrees(angle) for angle in (around_z, around_x, around_y)]
