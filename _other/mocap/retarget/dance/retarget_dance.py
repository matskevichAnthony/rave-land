"""Retarget Bandai Namco BVH dance mocap onto the auto-rig character.

Both skeletons differ in rest pose, so rotations transfer as world-space
deltas from a calibration frame (the static stance at the take start),
with per-bone direction matching absorbing the rest-pose mismatch.
Loop points are chosen by pose+velocity distance, the seam is blended,
clips go to NLA tracks and export as dance.glb.
"""
import math
from pathlib import Path

import bpy
import numpy as np
from mathutils import Quaternion, Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/mocap/retarget/dance')
AUTO_RIG = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')
BVH_DIR = Path('/home/anton-matzkaim/rave-land/_other/mocap/bandai')

FPS = 30
CALIB_FRAME = 10
BLEND_FRAMES = 15
MATCH_WINDOW = 5
EDGE_SKIP = 90
SWAY_WINDOW = 61
TARGET_TRIS = 32000
FORWARD = Vector((0.0, -1.0, 0.0))
UP = Vector((0.0, 0.0, 1.0))
BONE_AXIS = Vector((0.0, 1.0, 0.0))

BONE_MAP = {  # ours -> BVH, parents before children
    'hips': 'Hips',
    'spine': 'Spine',
    'chest': 'Chest',
    'neck': 'Neck',
    'head': 'Head',
    'upper_arm.L': 'UpperArm_L',
    'forearm.L': 'LowerArm_L',
    'hand.L': 'Hand_L',
    'upper_arm.R': 'UpperArm_R',
    'forearm.R': 'LowerArm_R',
    'hand.R': 'Hand_R',
    'thigh.L': 'UpperLeg_L',
    'shin.L': 'LowerLeg_L',
    'foot.L': 'Foot_L',
    'thigh.R': 'UpperLeg_R',
    'shin.R': 'LowerLeg_R',
    'foot.R': 'Foot_R',
}
BONES = list(BONE_MAP)

LOOP_WEIGHT = {
    'hips': 3.0, 'spine': 1.5, 'chest': 1.5, 'neck': 0.5, 'head': 0.7,
    'upper_arm.L': 1.2, 'forearm.L': 1.0, 'hand.L': 0.4,
    'upper_arm.R': 1.2, 'forearm.R': 1.0, 'hand.R': 0.4,
    'thigh.L': 2.0, 'shin.L': 1.5, 'foot.L': 1.0,
    'thigh.R': 2.0, 'shin.R': 1.5, 'foot.R': 1.0,
}
HEIGHT_WEIGHT = 10.0
TRAVEL_WEIGHT = 5.0
ENERGY_FLOOR = 0.8
LIFT_SMOOTH = 9

CLIPS = (
    ('Dance', 'dataset-1_dance-short_normal_001.bvh', 150, 330),
    ('DanceLong', 'dataset-1_dance-long_normal_001.bvh', 360, 720),
)


def yaw_quat(from_xy, to_xy):
    angle = math.atan2(from_xy[0] * to_xy[1] - from_xy[1] * to_xy[0],
                       from_xy[0] * to_xy[0] + from_xy[1] * to_xy[1])
    return Quaternion(UP, angle)


def sample_bvh(filepath):
    bpy.ops.wm.read_homefile(use_empty=True)
    bpy.ops.import_anim.bvh(filepath=str(filepath), global_scale=0.01,
                            use_fps_scale=False)
    obj = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
    frames = int(obj.animation_data.action.frame_range[1])
    scene = bpy.context.scene
    joints = list(BONE_MAP.values())
    quats, hips, facing = [], [], []
    calib = None
    for f in range(1, frames + 1):
        scene.frame_set(f)
        pose = obj.pose.bones
        world = {j: obj.matrix_world @ pose[j].matrix for j in joints}
        quats.append({j: world[j].to_quaternion() for j in joints})
        hips.append(tuple(world['Hips'].translation))
        left = world['UpperLeg_L'].translation - world['UpperLeg_R'].translation
        left.z = 0.0
        fwd = left.normalized().cross(UP)
        facing.append((fwd.x, fwd.y))
        if f == CALIB_FRAME:
            calib = {j: (world[j].to_quaternion(),
                         (world[j].to_3x3() @ BONE_AXIS).normalized())
                     for j in joints}
    print(f'SAMPLED {filepath.name}: {frames} frames')
    return {'quats': quats, 'hips': np.array(hips),
            'facing': np.array(facing), 'calib': calib}


def retarget_worlds(sample, rest):
    q_face = yaw_quat(sample['facing'][CALIB_FRAME - 1], FORWARD)
    offset = {}
    for bone, joint in BONE_MAP.items():
        q_calib, dir_calib = sample['calib'][joint]
        aim = rest['dir'][bone].rotation_difference(q_face @ dir_calib)
        offset[bone] = ((q_face @ q_calib).inverted()
                        @ aim @ rest['quat'][bone])
    world = [{b: q_face @ (frame[BONE_MAP[b]] @ offset[b]) for b in BONES}
             for frame in sample['quats']]
    return world, q_face


def moving_average(arr, window):
    pad = window // 2
    padded = np.pad(arr, ((pad, pad), (0, 0)), mode='edge')
    kernel = np.ones(window) / window
    return np.stack([np.convolve(padded[:, i], kernel, 'valid')
                     for i in range(arr.shape[1])], axis=1)


def find_loop(world, dz, hip_xy, l_min, l_max):
    n_frames = len(world)
    weights = np.array([LOOP_WEIGHT[b] for b in BONES])
    quats = np.array([[world[t][b][:] for b in BONES]
                      for t in range(n_frames)])
    step_dot = np.abs(np.sum(quats[1:] * quats[:-1], axis=2))
    energy = ((2 * np.arccos(np.clip(step_dot, -1, 1))) @ weights
              + HEIGHT_WEIGHT * np.abs(np.diff(dz)))
    ref_energy = np.median(energy[EDGE_SKIP:n_frames - EDGE_SKIP])
    cum_energy = np.concatenate([[0.0], np.cumsum(energy)])

    best = None
    for length in range(l_min, l_max + 1, 2):
        n_pairs = n_frames - length - MATCH_WINDOW
        s_hi = n_frames - length - MATCH_WINDOW - EDGE_SKIP
        if s_hi <= EDGE_SKIP:
            continue
        dot = np.abs(np.einsum('fbq,fbq->fb',
                               quats[:n_frames - length],
                               quats[length:]))
        dist = ((2 * np.arccos(np.clip(dot, -1, 1))) @ weights
                + HEIGHT_WEIGHT * np.abs(dz[:n_frames - length] - dz[length:]))
        windowed = np.convolve(dist, np.ones(MATCH_WINDOW), 'valid')[:n_pairs]
        starts = np.arange(len(windowed))
        seg_energy = (cum_energy[starts + length] - cum_energy[starts]) / length
        travel = np.linalg.norm(hip_xy[starts + length] - hip_xy[starts], axis=1)
        cost = windowed + TRAVEL_WEIGHT * travel
        cost[(starts < EDGE_SKIP) | (starts > s_hi)] = np.inf
        cost[seg_energy < ENERGY_FLOOR * ref_energy] = np.inf
        s = int(np.argmin(cost))
        if math.isfinite(cost[s]) and (best is None or cost[s] < best[0]):
            best = (float(cost[s]), s, length)
    if best is None:
        raise RuntimeError('no loop candidate passed the energy filter')
    cost, start, length = best
    print(f'LOOP start={start} length={length} ({length / FPS:.2f}s) '
          f'cost={cost:.3f}')
    return start, length


def blend_weight(i, length):
    if i <= length - BLEND_FRAMES:
        return 0.0
    t = (i - (length - BLEND_FRAMES)) / BLEND_FRAMES
    return t * t * (3 - 2 * t)


def build_output(world, dz, sway, start, length):
    frames = []
    for i in range(length + 1):
        src = start + i
        w = blend_weight(i, length)
        if w == 0.0:
            pose = dict(world[src])
            z, xy = dz[src], sway[src]
        else:
            prev = src - length
            pose = {b: world[src][b].slerp(world[prev][b], w) for b in BONES}
            z = (1 - w) * dz[src] + w * dz[prev]
            xy = (1 - w) * sway[src] + w * sway[prev]
        frames.append((pose, z, xy))
    return frames


def floor_lift(out_frames, rest, q_horiz):
    """Vertical hips lift keeping the rigid toe-length foot above the floor.

    The BVH skeleton bends its Toes joint on tiptoe frames; our single foot
    bone reaches the toe tip, so those frames poke below Z=0 without a lift.
    """
    rest_inv = {b: rest['quat'][b].inverted() for b in BONES}
    n = len(out_frames)
    lift = np.empty(n)
    for idx, (pose, z, xy) in enumerate(out_frames):
        off = q_horiz @ Vector((xy[0], xy[1], 0.0))
        off.z = z
        delta = {b: pose[b] @ rest_inv[b] for b in BONES}
        hips_head = rest['head']['hips'] + off
        penetration = []
        for chain in (('thigh.L', 'shin.L', 'foot.L'),
                      ('thigh.R', 'shin.R', 'foot.R')):
            head, prev = hips_head, 'hips'
            for b in chain:
                head = head + delta[prev] @ (rest['head'][b]
                                             - rest['head'][prev])
                prev = b
            foot = chain[-1]
            tip = head + delta[foot] @ (rest['tail'][foot]
                                        - rest['head'][foot])
            penetration.append(min(tip.z - rest['tail'][foot].z,
                                   head.z - rest['head'][foot].z))
        lift[idx] = max(0.0, -min(penetration))
    cycle = np.pad(lift[:n - 1], LIFT_SMOOTH, mode='wrap')
    kernel = np.ones(LIFT_SMOOTH) / LIFT_SMOOTH
    smoothed = np.convolve(cycle, kernel, 'same')[LIFT_SMOOTH:-LIFT_SMOOTH]
    return np.append(smoothed, smoothed[0])


def write_action(name, out_frames, rig, rest, q_horiz):
    parent = rest['parent']
    rest_inv = {b: rest['quat'][b].inverted() for b in BONES}
    lift = floor_lift(out_frames, rest, q_horiz)
    n = len(out_frames)
    quat_tracks = {b: np.empty((n, 4)) for b in BONES}
    loc_track = np.empty((n, 3))
    for idx, (pose, z, xy) in enumerate(out_frames):
        for b in BONES:
            par = parent[b]
            if par:
                basis = (rest_inv[b] @ rest['quat'][par]
                         @ pose[par].inverted() @ pose[b])
            else:
                basis = rest_inv[b] @ pose[b]
            quat_tracks[b][idx] = basis[:]
        off = q_horiz @ Vector((xy[0], xy[1], 0.0))
        off.z = z + lift[idx]
        loc_track[idx] = (rest_inv['hips'] @ off)[:]

    for track in quat_tracks.values():
        dots = np.sum(track[1:] * track[:-1], axis=1)
        track[1:] *= np.cumprod(np.where(dots < 0, -1.0, 1.0))[:, None]

    action = bpy.data.actions.new(name)
    frame_numbers = np.arange(n, dtype=float)

    def add_curves(data_path, values, group):
        for ch in range(values.shape[1]):
            fc = action.fcurves.new(data_path, index=ch, action_group=group)
            fc.keyframe_points.add(n)
            co = np.empty(2 * n)
            co[0::2] = frame_numbers
            co[1::2] = values[:, ch]
            fc.keyframe_points.foreach_set('co', co)
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
            fc.update()

    for b in BONES:
        rig.pose.bones[b].rotation_mode = 'QUATERNION'
        add_curves(f'pose.bones["{b}"].rotation_quaternion', quat_tracks[b], b)
    add_curves('pose.bones["hips"].location', loc_track, 'hips')
    return action


def stash_action(rig, action, last_frame):
    track = rig.animation_data.nla_tracks.new()
    track.name = action.name
    strip = track.strips.new(action.name, 0, action)
    strip.action_frame_start = 0
    strip.action_frame_end = last_frame
    track.mute = True
    rig.animation_data.action = None


def rig_rest(rig):
    return {
        'quat': {b.name: b.matrix_local.to_quaternion() for b in rig.data.bones},
        'dir': {b.name: (b.matrix_local.to_3x3() @ BONE_AXIS).normalized()
                for b in rig.data.bones},
        'parent': {b.name: b.parent.name if b.parent else None
                   for b in rig.data.bones},
        'head': {b.name: b.head_local.copy() for b in rig.data.bones},
        'tail': {b.name: b.tail_local.copy() for b in rig.data.bones},
    }


def main():
    samples = {name: sample_bvh(BVH_DIR / bvh) for name, bvh, _, _ in CLIPS}

    bpy.ops.wm.open_mainfile(filepath=str(AUTO_RIG / 'rig.blend'))
    rig = bpy.data.objects['Rig']
    mesh_obj = bpy.data.objects['Character']
    rest = rig_rest(rig)
    rig.animation_data_create()

    clip_lengths = {}
    for name, _, l_min, l_max in CLIPS:
        sample = samples[name]
        world, q_face = retarget_worlds(sample, rest)
        scale = (rig.data.bones['hips'].head_local.z
                 / sample['hips'][CALIB_FRAME - 1][2])
        dz = (sample['hips'][:, 2] - sample['hips'][CALIB_FRAME - 1][2]) * scale
        hip_xy = sample['hips'][:, :2]
        sway = (hip_xy - moving_average(hip_xy, SWAY_WINDOW)) * scale

        start, length = find_loop(world, dz, hip_xy, l_min, l_max)

        seg_facing = sample['facing'][start:start + length].mean(axis=0)
        face_now = q_face @ Vector((seg_facing[0], seg_facing[1], 0.0))
        q_fix = yaw_quat((face_now.x, face_now.y), FORWARD)
        world = [{b: q_fix @ q for b, q in frame.items()} for frame in world]

        out_frames = build_output(world, dz, sway, start, length)
        action = write_action(name, out_frames, rig, rest, q_fix @ q_face)
        stash_action(rig, action, length)
        clip_lengths[name] = length
        print(f'CLIP {name}: {length} frames ({length / FPS:.2f}s), '
              f'src frames {start}..{start + length}')

    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'retarget.blend'))
    print('SAVED retarget.blend')
    export_and_render(rig, mesh_obj, clip_lengths)
    print('DONE', clip_lengths)


def export_and_render(rig, mesh_obj, clip_lengths):

    tris = sum(len(p.vertices) - 2 for p in mesh_obj.data.polygons)
    decimate = mesh_obj.modifiers.new('Decimate', 'DECIMATE')
    decimate.ratio = TARGET_TRIS / tris
    decimate.use_collapse_triangulate = True
    mesh_obj.modifiers.move(mesh_obj.modifiers.find('Decimate'), 0)
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_obj
    bpy.ops.object.modifier_apply(modifier='Decimate')
    print('DECIMATED to',
          sum(len(p.vertices) - 2 for p in mesh_obj.data.polygons))

    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = max(clip_lengths.values())

    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(
        filepath=str(WORK / 'dance.glb'),
        export_format='GLB',
        export_apply=True,
        export_animations=True,
        export_animation_mode='NLA_TRACKS',
        export_force_sampling=True,
        export_frame_range=True,
        export_yup=True,
    )
    print('EXPORTED dance.glb')

    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(sun)
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 12
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 512
    scene.render.resolution_y = 768
    scene.world = bpy.data.worlds.new('W')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = \
        (0.7, 0.7, 0.75, 1)

    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    target = Vector((0, 0, 0.9))
    views = {'front': Vector((0.6, -3.2, 1.2)), 'side': Vector((3.2, -0.6, 1.2))}
    fractions = {'Dance': (0.05, 0.30, 0.55, 0.80),
                 'DanceLong': (0.20, 0.45, 0.70, 0.95)}

    for name, length in clip_lengths.items():
        rig.animation_data.action = bpy.data.actions[name]
        for i, fraction in enumerate(fractions[name], 1):
            scene.frame_set(int(length * fraction))
            for view, pos in views.items():
                cam.location = pos
                cam.rotation_mode = 'QUATERNION'
                cam.rotation_quaternion = \
                    (target - pos).to_track_quat('-Z', 'Y')
                scene.render.filepath = \
                    str(WORK / f'{name.lower()}-{view}-{i}.png')
                bpy.ops.render.render(write_still=True)
        rig.animation_data.action = None
    print('RENDERED previews')


if __name__ == '__main__':
    main()
