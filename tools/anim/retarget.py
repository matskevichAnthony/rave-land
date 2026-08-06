"""Retarget a BVH mocap clip onto the 17-bone character rig and export the full GLB.

Runs inside Blender headless (see bvh2clip). The source rest pose is unusable
(Bandai stores bones along local X, all-zero rotations give a contorted star),
so retargeting works with absolute world-rotation deltas: a reference frame t0
(the tallest standing pose of the clip) is matched to the target rest pose
positionally (bone direction + semantic hint axis), and every other frame is
the source's own world delta from t0 applied on top of that match. Intermediate
source joints (Shoulder_L/R, joint_Root) fold in automatically because only
world matrices are read.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent.parent
DEFAULT_RIG_DIR = REPO_ROOT / '_other' / 'auto-rig'


def resolve_rig_dir():
    """--rig-dir <path> перед '--' у Blender: каталог с rig.blend и landmarks.json.
    По умолчанию берётся риг Берлинца (_other/auto-rig), для остальных персонажей
    каталог указывается явно, например --rig-dir _other/bold-raver-rig."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if '--rig-dir' in argv:
        return Path(argv[argv.index('--rig-dir') + 1]).resolve()
    return DEFAULT_RIG_DIR


RIG_DIR = resolve_rig_dir()
if not (RIG_DIR / 'rig.blend').exists():
    raise SystemExit(f'rig.blend not found in {RIG_DIR} — воспроизведите риг '
                     f'скриптами step1_rig.py/step2_weights.py или укажите --rig-dir')
# Каталог рига может нести свои версии библиотек, но обычно их там нет и берутся
# эталонные: одна копия rig_lib/anim_lib на всех персонажей вместо копии на каждого.
sys.path.insert(0, str(RIG_DIR))
sys.path.append(str(DEFAULT_RIG_DIR))
import anim_lib
import rig_lib
# Хранилище клипов лежит рядом с ригом: локальные кватернионы считаются от rest-позы
# конкретного скелета, и общий на всех персонажей файл подмешивал бы чужие позы.
CLIP_STORE = RIG_DIR / 'clips.blend'
SCENE_FPS = 30
TARGET_TRIS = 32000
BVH_SCALE = 0.01
SWAY_WINDOW_SECONDS = 1.0
HINT_DEGENERACY_LIMIT = 0.15
T0_SCAN_STEPS = 400
UP = Vector((0, 0, 1))

# target bone -> (source joint, source child joint giving the bone direction).
# child None: the bone inherits its parent's rest alignment (source chain ends
# there without a measurable child position). New sources (CMU etc.) are added
# as new dicts here.
BONE_MAPS = {
    'bandai': {
        'hips': ('Hips', 'Spine'),
        'spine': ('Spine', 'Chest'),
        'chest': ('Chest', 'Neck'),
        'neck': ('Neck', 'Head'),
        'head': ('Head', None),
        'upper_arm.L': ('UpperArm_L', 'LowerArm_L'),
        'forearm.L': ('LowerArm_L', 'Hand_L'),
        'hand.L': ('Hand_L', None),
        'upper_arm.R': ('UpperArm_R', 'LowerArm_R'),
        'forearm.R': ('LowerArm_R', 'Hand_R'),
        'hand.R': ('Hand_R', None),
        'thigh.L': ('UpperLeg_L', 'LowerLeg_L'),
        'shin.L': ('LowerLeg_L', 'Foot_L'),
        'foot.L': ('Foot_L', 'Toes_L'),
        'thigh.R': ('UpperLeg_R', 'LowerLeg_R'),
        'shin.R': ('LowerLeg_R', 'Foot_R'),
        'foot.R': ('Foot_R', 'Toes_R'),
    },
}

BONE_ORDER = (
    'hips', 'spine', 'chest', 'neck', 'head',
    'upper_arm.L', 'forearm.L', 'hand.L',
    'upper_arm.R', 'forearm.R', 'hand.R',
    'thigh.L', 'shin.L', 'foot.L',
    'thigh.R', 'shin.R', 'foot.R',
)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:]
    p = argparse.ArgumentParser()
    p.add_argument('--bvh', required=True)
    p.add_argument('--name', required=True)
    p.add_argument('--start', type=float, default=0.0)
    p.add_argument('--end', type=float, default=None)
    p.add_argument('--fps', type=float, default=30.0)
    p.add_argument('--raw', required=True, help='raw GLB output path (pre-postprocess)')
    p.add_argument('--rig-dir', default=str(DEFAULT_RIG_DIR),
                   help='каталог рига: rig.blend, landmarks.json, anim_lib.py, rig_lib.py')
    return p.parse_args(argv)


def parse_bvh_header(path):
    n_frames = frame_time = None
    with open(path) as f:
        for line in f:
            if line.startswith('Frames:'):
                n_frames = int(line.split()[1])
            elif line.startswith('Frame Time:'):
                frame_time = float(line.split()[2])
                break
    if not n_frames or not frame_time:
        raise SystemExit(f'no MOTION header in {path}')
    return n_frames, frame_time


def pick_bone_map(joint_names):
    for map_name, bone_map in BONE_MAPS.items():
        needed = {j for pair in bone_map.values() for j in pair if j}
        if needed <= joint_names:
            return map_name, bone_map
    raise SystemExit(f'no bone map matches joints: {sorted(joint_names)}')


def make_frame(primary, hints):
    """Orthonormal frame (columns x,y,z) with y along primary, z from the first
    non-degenerate hint. The same recipe on source and target poses makes their
    frames semantically comparable."""
    y = primary.normalized()
    for hint in hints:
        z = y.cross(hint.normalized())
        if z.length > HINT_DEGENERACY_LIMIT:
            break
    z.normalize()
    x = y.cross(z)
    return Matrix(((x.x, y.x, z.x), (x.y, y.y, z.y), (x.z, y.z, z.z)))


def moving_average(values, window):
    if window < 2:
        return values.copy()
    pad = window // 2
    padded = np.concatenate((values[pad:0:-1], values, values[-2:-2 - pad:-1]))
    kernel = np.ones(window) / window
    return np.convolve(padded, kernel, mode='valid')[:len(values)]


def source_rotation(pre_quat, pose_bone):
    return pre_quat @ pose_bone.matrix.to_quaternion()


def main():
    args = parse_args()
    bpy.ops.wm.open_mainfile(filepath=str(RIG_DIR / 'rig.blend'))
    arm = bpy.data.objects['Rig']
    mesh = bpy.data.objects['Character']
    with open(RIG_DIR / 'landmarks.json') as f:
        fwd_sign = json.load(f)['forward']

    if CLIP_STORE.exists():
        with bpy.data.libraries.load(str(CLIP_STORE)) as (data_from, data_to):
            data_to.actions = data_from.actions
        print('STORE loaded:', sorted(a.name for a in bpy.data.actions))

    builder = anim_lib.ClipBuilder(arm, fwd_sign)
    for clip_name, build in anim_lib.CLIP_BUILDERS:
        if clip_name != args.name and clip_name not in bpy.data.actions:
            build(builder)

    n_frames, frame_time = parse_bvh_header(args.bvh)
    src_fps = 1.0 / frame_time
    duration = (n_frames - 1) * frame_time
    start = min(max(args.start, 0.0), duration)
    end = duration if args.end is None else min(args.end, duration)
    if end <= start:
        raise SystemExit(f'empty segment: start={start} end={end} (clip {duration:.1f}s)')
    print(f'BVH {n_frames} frames @ {src_fps:.2f} fps, segment {start:.2f}..{end:.2f}s')

    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(
        filepath=args.bvh, global_scale=BVH_SCALE, frame_start=1,
        use_fps_scale=False, update_scene_fps=False, update_scene_duration=False)
    bvh_obj = (set(bpy.data.objects) - before).pop()
    map_name, bone_map = pick_bone_map({pb.name for pb in bvh_obj.pose.bones})
    print('BONE MAP:', map_name)

    scene = bpy.context.scene
    hips_src = bone_map['hips'][0]

    scan_step = max(1, n_frames // T0_SCAN_STEPS)
    t0_frame, best_z = 1, -1e9
    for f in range(1, n_frames + 1, scan_step):
        scene.frame_set(f)
        z = (bvh_obj.matrix_world @ bvh_obj.pose.bones[hips_src].head).z
        if z > best_z:
            t0_frame, best_z = f, z
    print(f'T0 frame {t0_frame} (hips z {best_z:.3f}m)')

    scene.frame_set(t0_frame)
    mw = bvh_obj.matrix_world
    left_src = mw @ bvh_obj.pose.bones[bone_map['thigh.L'][0]].head \
        - mw @ bvh_obj.pose.bones[bone_map['thigh.R'][0]].head
    left_src.z = 0
    left_src.normalize()
    fwd_src = left_src.cross(UP)
    fwd_tgt = Vector((0, fwd_sign, 0))
    yaw = math.atan2(fwd_src.x * fwd_tgt.y - fwd_src.y * fwd_tgt.x, fwd_src.dot(fwd_tgt))
    pre4 = Matrix.Rotation(yaw, 4, 'Z') @ mw
    pre_quat = pre4.decompose()[1]
    print(f'YAW correction {math.degrees(yaw):.1f} deg')

    left = Vector((-fwd_sign, 0, 0))
    fwd = Vector((0, fwd_sign, 0))

    def hints_for(bone):
        if bone.startswith(('upper_arm', 'forearm', 'hand')):
            return (fwd, left, UP)
        if bone.startswith('foot'):
            return (UP, left)
        return (left, fwd)

    rest_rot = {b: (arm.matrix_world @ arm.pose.bones[b].bone.matrix_local).to_3x3()
                for b in BONE_ORDER}
    src_pos = {name: pre4 @ bvh_obj.pose.bones[name].head
               for name in {j for pair in bone_map.values() for j in pair if j}}
    hips_z0 = src_pos[hips_src].z
    tgt_hips_z = (arm.matrix_world @ arm.pose.bones['hips'].bone.head_local).z
    height_scale = tgt_hips_z / hips_z0

    w0 = {}
    q0_inv = {}
    parent_of = {b: (arm.pose.bones[b].parent.name if arm.pose.bones[b].parent else None)
                 for b in BONE_ORDER}
    for b in BONE_ORDER:
        src, child = bone_map[b]
        q0_inv[b] = source_rotation(pre_quat, bvh_obj.pose.bones[src]).inverted()
        if child is None:
            w0[b] = w0[parent_of[b]]
            continue
        m_tgt = make_frame(rest_rot[b] @ Vector((0, 1, 0)), hints_for(b))
        m_src = make_frame(src_pos[child] - src_pos[src], hints_for(b))
        w0[b] = (m_src @ m_tgt.inverted()).to_quaternion()

    fps_out = args.fps
    n_out = max(1, round((end - start) * fps_out))
    samples = []
    hips_track = np.empty((n_out + 1, 3))
    for i in range(n_out + 1):
        t = min(start + i / fps_out, duration)
        f = 1 + t * src_fps
        scene.frame_set(int(f), subframe=f - int(f))
        pre4_i = Matrix.Rotation(yaw, 4, 'Z') @ bvh_obj.matrix_world
        pre_quat_i = pre4_i.decompose()[1]
        quats = {b: source_rotation(pre_quat_i, bvh_obj.pose.bones[bone_map[b][0]])
                 for b in BONE_ORDER}
        samples.append(quats)
        hips_track[i] = pre4_i @ bvh_obj.pose.bones[hips_src].head

    window = int(SWAY_WINDOW_SECONDS * fps_out) | 1
    sway_x = (hips_track[:, 0] - moving_average(hips_track[:, 0], window)) * height_scale
    sway_y = (hips_track[:, 1] - moving_average(hips_track[:, 1], window)) * height_scale
    dz = (hips_track[:, 2] - hips_z0) * height_scale

    old = bpy.data.actions.get(args.name)
    if old:
        bpy.data.actions.remove(old)
    arm.animation_data_create()
    action = bpy.data.actions.new(args.name)
    arm.animation_data.action = action
    rest_inv = rig_lib.rest_rot_inverses(arm)
    prev_q = {}
    for i, quats in enumerate(samples):
        frame = i * SCENE_FPS / fps_out
        deltas = {}
        for b in BONE_ORDER:
            deltas[b] = quats[b] @ q0_inv[b] @ w0[b]
            parent = parent_of[b]
            w_key = deltas[parent].inverted() @ deltas[b] if parent else deltas[b]
            local_q = (rest_inv[b] @ w_key.to_matrix() @ rest_inv[b].inverted()).to_quaternion()
            if b in prev_q and prev_q[b].dot(local_q) < 0:
                local_q.negate()
            prev_q[b] = local_q
            pb = arm.pose.bones[b]
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = local_q
            pb.keyframe_insert('rotation_quaternion', frame=frame)
        hips_pb = arm.pose.bones['hips']
        hips_pb.location = rest_inv['hips'] @ Vector((sway_x[i], sway_y[i], dz[i]))
        hips_pb.keyframe_insert('location', frame=frame)
    print(f'RETARGETED {args.name}: {n_out + 1} keys, {(end - start):.2f}s')

    bvh_action = bvh_obj.animation_data.action
    bvh_data = bvh_obj.data
    bpy.data.objects.remove(bvh_obj, do_unlink=True)
    bpy.data.armatures.remove(bvh_data)
    bpy.data.actions.remove(bvh_action)

    for track in list(arm.animation_data.nla_tracks):
        arm.animation_data.nla_tracks.remove(track)
    core = [n for n in (name for name, _ in anim_lib.CLIP_BUILDERS) if n in bpy.data.actions]
    extras = sorted(a.name for a in bpy.data.actions if a.name not in core)
    for clip_name in core + extras:
        clip = bpy.data.actions[clip_name]
        anim_lib.stash_action(arm, clip, clip.frame_range[1])
    print('CLIPS:', core + extras)

    bpy.data.libraries.write(str(CLIP_STORE), set(bpy.data.actions), fake_user=True)
    print('STORE saved:', CLIP_STORE)

    tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
    decimate = mesh.modifiers.new('Decimate', 'DECIMATE')
    decimate.ratio = TARGET_TRIS / tris
    decimate.use_collapse_triangulate = True
    mesh.modifiers.move(mesh.modifiers.find('Decimate'), 0)
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.modifier_apply(modifier='Decimate')

    scene.render.fps = SCENE_FPS
    scene.frame_start = 0
    bpy.ops.object.select_all(action='DESELECT')
    Path(args.raw).parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=args.raw,
        export_format='GLB',
        export_apply=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_frame_range=True,
        export_yup=True,
    )
    print('EXPORTED', args.raw)


main()
