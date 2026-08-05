"""Retarget Bandai Namco walk BVH clips onto the auto-rig character and export GLB.

Transfer principle: absolute world orientation per bone with a constant per-bone
calibration C, so R_target(t) = R_bvh(t) @ C. C maps the BVH joint frame in a
semantically known pose (upright standing, probed axis directions) onto our
bone's rest orientation, lifted by the minimal rotation from the standing bone
direction to our rest bone direction (arms hang in the data but stick out in
our rest). Feet are calibrated at a detected flat-stance frame instead, because
the BVH foot bone points steeply down even when the foot is flat.
"""
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/mocap/retarget/walk')
AUTO_RIG = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')
BVH_DIR = Path('/home/anton-matzkaim/rave-land/_other/mocap/bandai')
GLOBAL_SCALE = 0.01
FPS = 30
TARGET_TRIS = 32000

CLIPS = (
    ('Walk', 'dataset-1_walk_normal_001.bvh'),
    ('WalkAngry', 'dataset-1_walk_angry_001.bvh'),
    ('WalkTired', 'dataset-1_walk_tired_001.bvh'),
    ('WalkFeminine', 'dataset-1_walk_feminine_001.bvh'),
)

BONE_MAP = {
    'hips': 'Hips', 'spine': 'Spine', 'chest': 'Chest',
    'neck': 'Neck', 'head': 'Head',
    'upper_arm.L': 'UpperArm_L', 'forearm.L': 'LowerArm_L', 'hand.L': 'Hand_L',
    'upper_arm.R': 'UpperArm_R', 'forearm.R': 'LowerArm_R', 'hand.R': 'Hand_R',
    'thigh.L': 'UpperLeg_L', 'shin.L': 'LowerLeg_L', 'foot.L': 'Foot_L',
    'thigh.R': 'UpperLeg_R', 'shin.R': 'LowerLeg_R', 'foot.R': 'Foot_R',
}
ORDER = ('hips', 'spine', 'chest', 'neck', 'head',
         'upper_arm.L', 'forearm.L', 'hand.L',
         'upper_arm.R', 'forearm.R', 'hand.R',
         'thigh.L', 'shin.L', 'foot.L',
         'thigh.R', 'shin.R', 'foot.R')
PARENT = {'hips': None, 'spine': 'hips', 'chest': 'spine', 'neck': 'chest',
          'head': 'neck',
          'upper_arm.L': 'chest', 'forearm.L': 'upper_arm.L',
          'hand.L': 'forearm.L',
          'upper_arm.R': 'chest', 'forearm.R': 'upper_arm.R',
          'hand.R': 'forearm.R',
          'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L',
          'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R'}

DIST_BONES = ('hips', 'thigh.L', 'shin.L', 'foot.L', 'thigh.R', 'shin.R',
              'foot.R', 'upper_arm.L', 'forearm.L', 'upper_arm.R', 'forearm.R')
Z_WEIGHT = 5.0
CYCLE_TOLERANCE = 8


def mat_cols(x, y, z):
    return Matrix((x, y, z)).transposed()


# BVH joint world axes (columns: local X, Y, Z) when the actor stands upright,
# probed from the imported data (probe_bvh.py).
S_HIPS = mat_cols((1, 0, 0), (0, 0, 1), (0, -1, 0))
S_TORSO = mat_cols((0, 1, 0), (0, 0, 1), (1, 0, 0))
S_LIMB_L = mat_cols((-1, 0, 0), (0, 0, -1), (0, -1, 0))
S_LIMB_R = mat_cols((1, 0, 0), (0, 0, -1), (0, 1, 0))
STANDING = {'hips': S_HIPS}
for _b in ('spine', 'chest', 'neck', 'head'):
    STANDING[_b] = S_TORSO
for _b in ('upper_arm.L', 'forearm.L', 'hand.L', 'thigh.L', 'shin.L'):
    STANDING[_b] = S_LIMB_L
for _b in ('upper_arm.R', 'forearm.R', 'hand.R', 'thigh.R', 'shin.R'):
    STANDING[_b] = S_LIMB_R
STANCE_CALIBRATED = ('foot.L', 'foot.R')


def import_bvh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=str(path), global_scale=GLOBAL_SCALE,
                            frame_start=0, use_fps_scale=False,
                            update_scene_fps=False,
                            update_scene_duration=False)
    obj = next(o for o in bpy.data.objects if o not in before)
    action = obj.animation_data.action
    n_frames = int(round(action.frame_range[1] - action.frame_range[0])) + 1
    first = int(round(action.frame_range[0]))
    return obj, first, n_frames


def joint_world_matrix(bvh_obj, joint):
    return bvh_obj.matrix_world @ bvh_obj.pose.bones[joint].matrix


def sample_bvh(bvh_obj, first, n_frames):
    """World rotations of mapped joints and key positions for every frame."""
    frames = []
    scene = bpy.context.scene
    for f in range(n_frames):
        scene.frame_set(first + f)
        rots = {bone: joint_world_matrix(bvh_obj, joint).to_3x3()
                for bone, joint in BONE_MAP.items()}
        hips_z = joint_world_matrix(bvh_obj, 'Hips').translation.z
        feet_z = {side: (joint_world_matrix(bvh_obj, f'Foot_{side}').translation.z
                         + joint_world_matrix(bvh_obj, f'Toes_{side}').translation.z)
                  for side in 'LR'}
        frames.append({'rots': rots, 'hips_z': hips_z, 'feet_z': feet_z})
    return frames


def rest_matrices(rig):
    return {b: (rig.matrix_world @ rig.pose.bones[b].bone.matrix_local).to_3x3()
            for b in ORDER}


def calibration(rest, frames):
    """Per-bone constant C with R_target(t) = R_bvh(t) @ C."""
    calib = {}
    for bone, standing in STANDING.items():
        rest_dir = rest[bone].col[1].normalized()
        lift = Vector(standing.col[1]).rotation_difference(rest_dir).to_matrix()
        equiv = lift @ standing
        calib[bone] = equiv.inverted() @ rest[bone]
    for bone, side in zip(STANCE_CALIBRATED, 'LR'):
        stance = min(range(len(frames)), key=lambda f: frames[f]['feet_z'][side])
        calib[bone] = frames[stance]['rots'][bone].inverted() @ rest[bone]
        print(f'  stance frame for {bone}: {stance}')
    return calib


def world_deltas(frames, calib, rest):
    """Per frame, per bone: world rotation delta D with world = D @ rest."""
    rest_inv = {b: rest[b].inverted() for b in ORDER}
    return [{b: fr['rots'][b] @ calib[b] @ rest_inv[b] for b in ORDER}
            for fr in frames]


def straighten_heading(deltas):
    """Yaw everything so the average hips facing is exactly -Y."""
    mean = Vector((0.0, 0.0, 0.0))
    for fr in deltas:
        mean += fr['hips'] @ Vector((0, -1, 0))
    yaw_err = math.atan2(mean.x, -mean.y)
    fix = Matrix.Rotation(-yaw_err, 3, 'Z')
    for fr in deltas:
        for b in ORDER:
            fr[b] = fix @ fr[b]
    return math.degrees(yaw_err)


def estimate_period(deltas, rest):
    signal = [-(fr['thigh.L'] @ rest['thigh.L']).col[1].y for fr in deltas]
    mean = sum(signal) / len(signal)
    signal = [s - mean for s in signal]
    n = len(signal)
    best_lag, best_score = None, -math.inf
    for lag in range(15, min(100, n // 2)):
        pairs = n - lag
        score = sum(signal[t] * signal[t + lag] for t in range(pairs)) / pairs
        if score > best_score:
            best_lag, best_score = lag, score
    return best_lag


def rot_angle(qa, qb):
    return 2 * math.acos(min(1.0, abs(qa.dot(qb))))


def find_loop(deltas, frames, period):
    quats = [{b: fr[b].to_quaternion() for b in DIST_BONES} for fr in deltas]
    n = len(deltas)
    cycles = 2 if 2 * period + CYCLE_TOLERANCE < n else 1
    lo = cycles * period - CYCLE_TOLERANCE
    hi = cycles * period + CYCLE_TOLERANCE
    best = None
    for a in range(0, n - lo):
        for b in range(a + lo, min(a + hi, n - 1) + 1):
            dist = sum(rot_angle(quats[a][bone], quats[b][bone])
                       for bone in DIST_BONES)
            dist += Z_WEIGHT * abs(frames[a]['hips_z'] - frames[b]['hips_z'])
            if best is None or dist < best[0]:
                best = (dist, a, b)
    return best


def key_clip(rig, name, deltas, frames, loop, z_ref, bob_scale):
    _, a, b = loop
    rest = rest_matrices(rig)
    rest_inv = {bone: rest[bone].inverted() for bone in ORDER}
    rig.animation_data_create()
    action = bpy.data.actions.new(name)
    rig.animation_data.action = action
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    prev = {}
    length = b - a
    for i in range(length + 1):
        src = a + i if i < length else a
        fr = deltas[src]
        for bone in ORDER:
            parent = PARENT[bone]
            w_self = fr[bone] if parent is None else fr[parent].inverted() @ fr[bone]
            local = rest_inv[bone] @ w_self @ rest[bone]
            quat = local.to_quaternion()
            if bone in prev and quat.dot(prev[bone]) < 0:
                quat.negate()
            prev[bone] = quat
            pb = rig.pose.bones[bone]
            pb.rotation_quaternion = quat
            pb.keyframe_insert('rotation_quaternion', frame=i)
        dz = (frames[src]['hips_z'] - z_ref) * bob_scale
        hips = rig.pose.bones['hips']
        hips.location = rest_inv['hips'] @ Vector((0.0, 0.0, dz))
        hips.keyframe_insert('location', frame=i)
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, action)
    strip.action_frame_start = 0
    strip.action_frame_end = length
    track.mute = True
    rig.animation_data.action = None
    return length


def decimate(mesh_obj):
    tris = sum(len(p.vertices) - 2 for p in mesh_obj.data.polygons)
    if tris <= TARGET_TRIS:
        return
    mod = mesh_obj.modifiers.new('Decimate', 'DECIMATE')
    mod.ratio = TARGET_TRIS / tris
    mod.use_collapse_triangulate = True
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.object.modifier_apply(modifier='Decimate')
    print('DECIMATED to', sum(len(p.vertices) - 2 for p in mesh_obj.data.polygons),
          'tris from', tris)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(AUTO_RIG / 'rig.blend'))
    rig = bpy.data.objects['Rig']
    mesh_obj = bpy.data.objects['Character']
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0

    rest = rest_matrices(rig)
    our_pelvis_z = rig.pose.bones['hips'].bone.head_local.z

    calib = None
    z_ref = None
    bob_scale = None
    lengths = {}
    for name, filename in CLIPS:
        print('CLIP', name, filename)
        bvh_obj, first, n_frames = import_bvh(BVH_DIR / filename)
        frames = sample_bvh(bvh_obj, first, n_frames)
        if calib is None:
            calib = calibration(rest, frames)
        deltas = world_deltas(frames, calib, rest)
        yaw_err = straighten_heading(deltas)
        period = estimate_period(deltas, rest)
        loop = find_loop(deltas, frames, period)
        dist, a, b = loop
        if z_ref is None:
            zs = sorted(fr['hips_z'] for fr in frames[a:b])
            z_ref = zs[len(zs) // 2]
            bob_scale = our_pelvis_z / z_ref
        length = key_clip(rig, name, deltas, frames, loop, z_ref, bob_scale)
        lengths[name] = length
        print(f'  frames={n_frames} period={period} loop=[{a},{b}] '
              f'len={length} ({length / FPS:.2f}s) dist={dist:.3f} '
              f'yaw_fix={yaw_err:.1f}deg')
        bvh_action = bvh_obj.animation_data.action
        bpy.data.objects.remove(bvh_obj, do_unlink=True)
        bpy.data.actions.remove(bvh_action)

    decimate(mesh_obj)
    scene.frame_end = max(lengths.values())
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=str(WORK / 'walk.glb'),
        export_format='GLB',
        export_apply=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_frame_range=True,
        export_yup=True,
    )
    print('EXPORTED', WORK / 'walk.glb')
    print('LENGTHS', lengths)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'walk.blend'))


main()
