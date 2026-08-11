#!/usr/bin/env python3
"""GTA San Andreas ped animation -> BVH, ready for tools/anim/bvh2clip.

ped.ifp carries absolute local rotations per bone and translations for the root
alone, so the rest skeleton those rotations animate is simply not in the file.
SA_SKELETON below fills that gap with plausible proportions for a 1.75 m adult,
laid out in the axis convention the data does reveal: every bone's local X runs
down the bone toward its child and local Z points to the character's left, which
is why straight chains offset along X and only the branching joints (pelvis to
thighs, neck to clavicles) offset sideways. Exact figures would have to come out
of a ped .dff. retarget.py calibrates against a reference frame and reads world
orientations, so bone directions are what matter here and lengths only set the
scale of the root sway.
"""
import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from bvh_writer import Joint, write_bvh
from gta.ifp import load_ifp

DEFAULT_FPS = 30.0

# The SA root sits at hip level and its translations are deviations from there,
# while a BVH is read as standing on the ground, so the root offset lifts the
# whole figure by one hip height.
HIP_HEIGHT = 0.93

# bone id, joint name, parent bone id, offset from the parent in metres.
SA_SKELETON = (
    (0, 'Root', None, (0.0, 0.0, HIP_HEIGHT)),
    (1, 'Pelvis', 0, (-0.005, 0.004, 0.0)),
    (2, 'Spine', 1, (0.10, 0.0, 0.0)),
    (3, 'Spine1', 2, (0.16, 0.0, 0.0)),
    (4, 'Neck', 3, (0.24, 0.0, 0.0)),
    (5, 'Head', 4, (0.10, 0.0, 0.0)),
    (31, 'L_Clavicle', 4, (0.0, 0.0, 0.03125)),
    (32, 'L_UpperArm', 31, (0.17, 0.0, 0.0)),
    (33, 'L_ForeArm', 32, (0.28, 0.0, 0.0)),
    (34, 'L_Hand', 33, (0.26, 0.0, 0.0)),
    (35, 'L_Finger', 34, (0.09, 0.0, 0.0)),
    (36, 'L_Finger01', 35, (0.04, 0.0, 0.0)),
    (21, 'R_Clavicle', 4, (0.0, 0.0, -0.03125)),
    (22, 'R_UpperArm', 21, (0.17, 0.0, 0.0)),
    (23, 'R_ForeArm', 22, (0.28, 0.0, 0.0)),
    (24, 'R_Hand', 23, (0.26, 0.0, 0.0)),
    (25, 'R_Finger', 24, (0.09, 0.0, 0.0)),
    (26, 'R_Finger01', 25, (0.04, 0.0, 0.0)),
    (41, 'L_Thigh', 1, (0.0, 0.0, 0.09)),
    (42, 'L_Calf', 41, (0.43, 0.0, 0.0)),
    (43, 'L_Foot', 42, (0.42, 0.0, 0.0)),
    (44, 'L_Toe0', 43, (0.05, 0.13, 0.0)),
    (51, 'R_Thigh', 1, (0.0, 0.0, -0.09)),
    (52, 'R_Calf', 51, (0.43, 0.0, 0.0)),
    (53, 'R_Foot', 52, (0.42, 0.0, 0.0)),
    (54, 'R_Toe0', 53, (0.05, 0.13, 0.0)),
)

# BVH needs an End Site on every childless joint to give its bone a direction.
LEAF_TIPS = {
    'Head': (0.18, 0.0, 0.0),
    'L_Finger01': (0.03, 0.0, 0.0),
    'R_Finger01': (0.03, 0.0, 0.0),
    'L_Toe0': (0.0, 0.06, 0.0),
    'R_Toe0': (0.0, 0.06, 0.0),
}

JOINT_NAME = {bone_id: name for bone_id, name, _, _ in SA_SKELETON}


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('ifp', type=Path, help='ANP3 package, e.g. ped.ifp')
    parser.add_argument('name', help='animation to extract, e.g. IDLE_stance')
    parser.add_argument('-o', '--output', type=Path, required=True, help='BVH file to write')
    parser.add_argument('--fps', type=float, default=DEFAULT_FPS,
                        help=f'uniform frame rate to resample onto (default {DEFAULT_FPS:g})')
    return parser.parse_args()


def build_skeleton():
    joints = {bone_id: Joint(name, offset, tip=LEAF_TIPS.get(name))
              for bone_id, name, _, offset in SA_SKELETON}
    for bone_id, _, parent_id, _ in SA_SKELETON:
        if parent_id is not None:
            joints[parent_id].children.append(joints[bone_id])
    return joints[SA_SKELETON[0][0]]


def find_animation(animations, name):
    wanted = name.casefold()
    for animation in animations:
        if animation.name.casefold() == wanted:
            return animation
    raise SystemExit(f'no animation named {name!r}; list them with '
                     f'python3 {Path(__file__).with_name("ifp.py")} <file> --list')


def main():
    args = parse_args()
    animation = find_animation(load_ifp(args.ifp), args.name)
    tracks = {}
    ignored = set()
    for track in animation.bones:
        name = JOINT_NAME.get(track.bone_id)
        if name is None:
            ignored.add(f'{track.bone_id}:{track.name.strip()}')
            continue
        tracks[name] = [(frame.time, frame.rot, frame.pos) for frame in track.frames]

    frames = write_bvh(args.output, build_skeleton(), tracks, args.fps)
    print(f'{animation.name}: {frames} frames @ {args.fps:g} fps, '
          f'{animation.duration:.2f}s -> {args.output}')
    if ignored:
        print('bones outside the retargeted skeleton, skipped:', ', '.join(sorted(ignored)),
              file=sys.stderr)


if __name__ == '__main__':
    main()
