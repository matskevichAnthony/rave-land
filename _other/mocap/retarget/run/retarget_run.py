"""Retarget the Bandai run BVH onto the Rig armature and export run.glb.

The BVH rest pose is unusable as a binding reference (bone axes lie along +X),
so the transfer works from world joint positions instead: hips and chest get a
full basis built from two skeleton vectors, every other bone aims its rest
direction at the source bone's current world direction with minimal twist
propagated down from its parent.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

AUTO_RIG = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')
WORK = Path('/home/anton-matzkaim/rave-land/_other/mocap/retarget/run')
BVH = Path('/home/anton-matzkaim/rave-land/_other/mocap/bandai/dataset-1_run_normal_001.bvh')
sys.path.insert(0, str(AUTO_RIG))
import anim_lib
import rig_lib

FPS = 30
CYCLE_FRAMES = 23  # the 24 BVH frames are one loop whose last pose equals the first
SRC_HIPS_STAND_Z = 0.9399  # Hips offset in the BVH, metres after 0.01 scale
TAIL = 'TAIL'

BONE_ORDER = ['hips', 'spine', 'chest', 'neck', 'head',
              'upper_arm.L', 'forearm.L', 'hand.L',
              'upper_arm.R', 'forearm.R', 'hand.R',
              'thigh.L', 'shin.L', 'foot.L',
              'thigh.R', 'shin.R', 'foot.R']

AIM = {
    'spine': ('Spine', 'Chest'),
    'neck': ('Neck', 'Head'),
    'head': ('Head', TAIL),
    'upper_arm.L': ('UpperArm_L', 'LowerArm_L'),
    'forearm.L': ('LowerArm_L', 'Hand_L'),
    'hand.L': ('Hand_L', TAIL),
    'upper_arm.R': ('UpperArm_R', 'LowerArm_R'),
    'forearm.R': ('LowerArm_R', 'Hand_R'),
    'hand.R': ('Hand_R', TAIL),
    'thigh.L': ('UpperLeg_L', 'LowerLeg_L'),
    'shin.L': ('LowerLeg_L', 'Foot_L'),
    'foot.L': ('Foot_L', 'Toes_L'),
    'thigh.R': ('UpperLeg_R', 'LowerLeg_R'),
    'shin.R': ('LowerLeg_R', 'Foot_R'),
    'foot.R': ('Foot_R', 'Toes_R'),
}
# side specs are (from, to) like AIM, so right-to-left gives the leftward axis
BASIS = {
    'hips': (('Hips', 'Spine'), ('UpperLeg_R', 'UpperLeg_L')),
    'chest': (('Chest', 'Neck'), ('Shoulder_R', 'Shoulder_L')),
}


def make_basis(up, side):
    e_up = up.normalized()
    e_side = (side - side.project(e_up)).normalized()
    e_fwd = e_up.cross(e_side)
    return Matrix((e_side, e_fwd, e_up)).transposed()


def src_point(src, name):
    if name == TAIL:
        raise ValueError('TAIL is resolved by src_dir')
    return src.matrix_world @ src.pose.bones[name].head


def src_dir(src, spec):
    joint, to = spec
    pb = src.pose.bones[joint]
    if to == TAIL:
        return (src.matrix_world @ pb.tail) - (src.matrix_world @ pb.head)
    return src_point(src, to) - src_point(src, joint)


def rest_world_dirs(arm):
    dirs = {}
    for b in arm.data.bones:
        head = arm.matrix_world @ b.head_local
        tail = arm.matrix_world @ b.tail_local
        dirs[b.name] = (tail - head).normalized()
    return dirs


def target_rest_bases(arm, rest_dirs):
    def head(name):
        return arm.matrix_world @ arm.data.bones[name].head_local
    return {
        'hips': make_basis(rest_dirs['hips'], head('thigh.L') - head('thigh.R')),
        'chest': make_basis(rest_dirs['chest'], head('upper_arm.L') - head('upper_arm.R')),
    }


def pitch_of(direction):
    return math.atan2(direction.z, direction.xy.length)


def repitch(direction, delta_pitch):
    """Rotate a direction in its own vertical plane by delta_pitch."""
    horizontal = Vector((direction.x, direction.y, 0.0))
    if horizontal.length < 1e-4:
        return direction
    pitch = pitch_of(direction) + delta_pitch
    return horizontal.normalized() * math.cos(pitch) + Vector((0, 0, 1)) * math.sin(pitch)


def foot_pitch_fixes(src, rest_dirs, frames):
    """Constant per-side pitch offset: source ankle-toe runs steeper than our
    rest foot bone, so absolute transfer would point the toes into the floor.
    Calibrated at each foot's flattest stance frame (lowest ankle)."""
    ankle_z = {side: {} for side in ('L', 'R')}
    for fr in frames:
        bpy.context.scene.frame_set(fr)
        for side in ('L', 'R'):
            ankle_z[side][fr] = src_point(src, f'Foot_{side}').z
    fixes = {}
    for side in ('L', 'R'):
        stance = min(ankle_z[side], key=ankle_z[side].get)
        bpy.context.scene.frame_set(stance)
        src_pitch = pitch_of(src_dir(src, AIM[f'foot.{side}']))
        fixes[f'foot.{side}'] = pitch_of(rest_dirs[f'foot.{side}']) - src_pitch
        print(f'FOOT PITCH FIX {side} stance frame {stance} '
              f'{math.degrees(fixes[f"foot.{side}"]):.1f} deg')
    return fixes


def frame_deltas(src, tgt_bases, rest_dirs, parent_of, pitch_fixes):
    """World delta quaternion per target bone for the current scene frame."""
    deltas = {}
    for bone in BONE_ORDER:
        if bone in BASIS:
            up_spec, side_spec = BASIS[bone]
            src_basis = make_basis(src_dir(src, up_spec), src_dir(src, side_spec))
            deltas[bone] = (src_basis @ tgt_bases[bone].inverted()).to_quaternion()
            continue
        parent_delta = deltas[parent_of[bone]]
        current = parent_delta @ rest_dirs[bone]
        desired = src_dir(src, AIM[bone]).normalized()
        if bone in pitch_fixes:
            desired = repitch(desired, pitch_fixes[bone])
        deltas[bone] = current.rotation_difference(desired) @ parent_delta
    return deltas


def key_frame(arm, rest_inv, deltas, parent_of, frame, hips_dz):
    for bone in BONE_ORDER:
        parent = parent_of[bone]
        world = deltas[parent].inverted() @ deltas[bone] if parent else deltas[bone]
        rig_lib.key_world_rotation(arm.pose.bones[bone], rest_inv[bone], world, frame)
    hips = arm.pose.bones['hips']
    hips.location = rest_inv['hips'] @ Vector((0.0, 0.0, hips_dz))
    hips.keyframe_insert('location', frame=frame)


def lowest_foot_z(arm, frames):
    lowest = float('inf')
    for fr in frames:
        bpy.context.scene.frame_set(fr)
        for side in ('L', 'R'):
            pb = arm.pose.bones[f'foot.{side}']
            rest = arm.data.bones[f'foot.{side}']
            head_clearance = (arm.matrix_world @ pb.head).z - (arm.matrix_world @ rest.head_local).z
            tail_clearance = (arm.matrix_world @ pb.tail).z - (arm.matrix_world @ rest.tail_local).z
            lowest = min(lowest, head_clearance, tail_clearance)
    return lowest


bpy.ops.wm.open_mainfile(filepath=str(AUTO_RIG / 'rig.blend'))
arm_obj = bpy.data.objects['Rig']
mesh_obj = bpy.data.objects['Character']
scene = bpy.context.scene
scene.render.fps = FPS

# the importer clamps frame_start to 1, so source frames live at 1..24
bpy.ops.import_anim.bvh(filepath=str(BVH), global_scale=0.01, frame_start=1,
                        use_fps_scale=False, update_scene_fps=False,
                        update_scene_duration=False)
SRC_FRAME_OFFSET = 1
src_obj = bpy.context.view_layer.objects.active

rest_inv = rig_lib.rest_rot_inverses(arm_obj)
rest_dirs = rest_world_dirs(arm_obj)
tgt_bases = target_rest_bases(arm_obj, rest_dirs)
parent_of = {pb.name: pb.parent.name if pb.parent else None for pb in arm_obj.pose.bones}
height_ratio = (arm_obj.matrix_world @ arm_obj.data.bones['hips'].head_local).z / SRC_HIPS_STAND_Z

src_frames = [fr + SRC_FRAME_OFFSET for fr in range(CYCLE_FRAMES)]
pitch_fixes = foot_pitch_fixes(src_obj, rest_dirs, src_frames)
frames_data = []
for fr in src_frames:
    scene.frame_set(fr)
    hips_z = src_point(src_obj, 'Hips').z
    dz = (hips_z - SRC_HIPS_STAND_Z) * height_ratio
    frames_data.append((frame_deltas(src_obj, tgt_bases, rest_dirs, parent_of,
                                     pitch_fixes), dz))

arm_obj.animation_data_create()
action = bpy.data.actions.new('Run')
arm_obj.animation_data.action = action


def key_all(ground_bias):
    for fr, (deltas, dz) in enumerate(frames_data):
        key_frame(arm_obj, rest_inv, deltas, parent_of, fr, dz + ground_bias)
    first_deltas, first_dz = frames_data[0]
    key_frame(arm_obj, rest_inv, first_deltas, parent_of, CYCLE_FRAMES, first_dz + ground_bias)


key_all(0.0)
bias = -lowest_foot_z(arm_obj, range(CYCLE_FRAMES))
print(f'GROUND BIAS {bias:.4f}')
key_all(bias)

src_action = src_obj.animation_data.action
bpy.data.objects.remove(src_obj, do_unlink=True)
bpy.data.actions.remove(src_action)

anim_lib.stash_action(arm_obj, action, CYCLE_FRAMES)

tris = sum(len(p.vertices) - 2 for p in mesh_obj.data.polygons)
decimate = mesh_obj.modifiers.new('Decimate', 'DECIMATE')
decimate.ratio = 32000 / tris
decimate.use_collapse_triangulate = True
mesh_obj.modifiers.move(mesh_obj.modifiers.find('Decimate'), 0)
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_obj
bpy.ops.object.modifier_apply(modifier='Decimate')

scene.frame_start = 0
scene.frame_end = CYCLE_FRAMES
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(
    filepath=str(WORK / 'run.glb'),
    export_format='GLB',
    export_apply=True,
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_force_sampling=True,
    export_frame_range=True,
    export_yup=True,
)
print('EXPORTED', WORK / 'run.glb')
