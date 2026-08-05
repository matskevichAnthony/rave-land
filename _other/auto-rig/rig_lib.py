"""Shared helpers for the auto-rig pipeline (runs inside Blender)."""
import json
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

TARGET_HEIGHT = 1.75


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block_list in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions):
        for block in list(block_list):
            if block.users == 0:
                block_list.remove(block)


def import_and_normalize(glb_path):
    """Import GLB, join meshes, scale to TARGET_HEIGHT, feet at Z=0, origin at center-bottom."""
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=glb_path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise RuntimeError('no meshes imported')
    for o in bpy.context.scene.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = 'Character'
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    for o in list(bpy.context.scene.objects):
        if o.type == 'EMPTY':
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    verts = get_verts(obj)
    z_min, z_max = verts[:, 2].min(), verts[:, 2].max()
    scale = TARGET_HEIGHT / (z_max - z_min)
    obj.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(scale=True)
    verts = get_verts(obj)
    center_x = (verts[:, 0].min() + verts[:, 0].max()) / 2
    center_y = (verts[:, 1].min() + verts[:, 1].max()) / 2
    obj.location = (-center_x, -center_y, -verts[:, 2].min())
    bpy.ops.object.transform_apply(location=True)
    return obj


def get_verts(obj):
    mesh = obj.data
    arr = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get('co', arr)
    return arr.reshape(-1, 3)


def detect_landmarks(obj):
    """Find humanoid joint positions from T-pose vertex distribution."""
    v = get_verts(obj)
    height = v[:, 2].max()
    x_max = v[:, 0].max()

    arm = v[(v[:, 0] > 0.55 * x_max)]
    shoulder_z = float(np.median(arm[:, 2]))
    arm_y = float(np.median(arm[:, 1]))

    hand_tip_x = x_max
    torso_band = v[(np.abs(v[:, 2] - shoulder_z) < 0.05 * height)]
    xs = np.sort(torso_band[:, 0])
    hist, edges = np.histogram(torso_band[:, 0], bins=80)
    centers = (edges[:-1] + edges[1:]) / 2
    dense = hist > hist.max() * 0.25
    torso_right = centers[dense][centers[dense] > 0]
    shoulder_x = float(torso_right.max()) if len(torso_right) else 0.11 * height
    shoulder_x = min(shoulder_x, 0.115 * height)

    arm_len = hand_tip_x - shoulder_x
    wrist_x = shoulder_x + 0.78 * arm_len
    elbow_x = shoulder_x + 0.42 * arm_len

    def arm_point(x_target):
        band = arm[np.abs(arm[:, 0] - x_target) < 0.035 * height]
        if len(band) < 5:
            band = arm
        return float(np.median(band[:, 1])), float(np.median(band[:, 2]))

    sh_y, sh_z = arm_point(shoulder_x + 0.05 * arm_len)
    el_y, el_z = arm_point(elbow_x)
    wr_y, wr_z = arm_point(wrist_x)
    tip_y, tip_z = arm_point(hand_tip_x - 0.02 * arm_len)

    center_col = v[(np.abs(v[:, 0]) < 0.025 * height) & (v[:, 2] > 0.2 * height) & (v[:, 2] < 0.65 * height)]
    crotch_z = float(center_col[:, 2].min()) if len(center_col) else 0.47 * height
    crotch_z = min(max(crotch_z, 0.38 * height), 0.55 * height)

    legs = v[(v[:, 2] < crotch_z) & (v[:, 0] > 0.01)]
    ankle_z = 0.045 * height

    def leg_point(z_target):
        band = legs[np.abs(legs[:, 2] - z_target) < 0.03 * height]
        if len(band) < 5:
            band = legs
        return float(np.median(band[:, 0])), float(np.median(band[:, 1]))

    hip_joint_z = crotch_z + 0.04 * height
    thigh_x, thigh_y = leg_point(crotch_z - 0.05 * height)
    knee_z = (hip_joint_z + ankle_z) * 0.53
    knee_x, knee_y = leg_point(knee_z)
    ankle_x, ankle_y = leg_point(ankle_z + 0.02 * height)

    foot = v[(v[:, 2] < 0.05 * height) & (v[:, 0] > 0.01)]
    if len(foot):
        toe_y_a, toe_y_b = float(foot[:, 1].min()), float(foot[:, 1].max())
        forward = -1.0 if abs(toe_y_a - ankle_y) > abs(toe_y_b - ankle_y) else 1.0
        toe_y = toe_y_a if forward < 0 else toe_y_b
    else:
        forward, toe_y = -1.0, ankle_y - 0.1
    pelvis_z = hip_joint_z + 0.02 * height

    torso = v[(np.abs(v[:, 0]) < 0.12 * height)]

    def torso_y(z_target):
        band = torso[np.abs(torso[:, 2] - z_target) < 0.03 * height]
        if len(band) < 5:
            return 0.0
        return float(np.median(band[:, 1]))

    lm = {
        'height': float(height),
        'forward': float(forward),
        'pelvis': [0.0, torso_y(pelvis_z), float(pelvis_z)],
        'spine_top': [0.0, torso_y(pelvis_z + 0.10 * height), float(pelvis_z + 0.10 * height)],
        'chest_top': [0.0, torso_y(sh_z), float(sh_z)],
        'neck_top': [0.0, torso_y(sh_z) * 0.8, float(sh_z + 0.35 * (height - sh_z))],
        'head_top': [0.0, torso_y(sh_z) * 0.5, float(height * 0.99)],
        'shoulder': [float(shoulder_x), sh_y, sh_z],
        'elbow': [float(elbow_x), el_y, el_z],
        'wrist': [float(wrist_x), wr_y, wr_z],
        'hand_tip': [float(hand_tip_x), tip_y, tip_z],
        'hip_joint': [float(thigh_x), thigh_y, float(hip_joint_z)],
        'knee': [float(knee_x), knee_y, float(knee_z)],
        'ankle': [float(ankle_x), ankle_y, float(ankle_z)],
        'toe': [float(ankle_x), float(toe_y), 0.02],
    }
    return lm


def mirror(p):
    return [-p[0], p[1], p[2]]


def build_armature(lm):
    bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
    arm_obj = bpy.context.view_layer.objects.active
    arm_obj.name = 'Rig'
    eb = arm_obj.data.edit_bones
    for b in list(eb):
        eb.remove(b)

    def add(name, head, tail, parent=None, connect=False):
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        return b

    add('hips', lm['pelvis'], lm['spine_top'])
    add('spine', lm['spine_top'], midpoint(lm['spine_top'], lm['chest_top']), 'hips', True)
    add('chest', midpoint(lm['spine_top'], lm['chest_top']), lm['chest_top'], 'spine', True)
    add('neck', lm['chest_top'], lm['neck_top'], 'chest', True)
    add('head', lm['neck_top'], lm['head_top'], 'neck', True)
    for side, sgn in (('L', 1), ('R', -1)):
        def s(p):
            return p if sgn > 0 else mirror(p)
        add(f'upper_arm.{side}', s(lm['shoulder']), s(lm['elbow']), 'chest')
        add(f'forearm.{side}', s(lm['elbow']), s(lm['wrist']), f'upper_arm.{side}', True)
        add(f'hand.{side}', s(lm['wrist']), s(lm['hand_tip']), f'forearm.{side}', True)
        add(f'thigh.{side}', s(lm['hip_joint']), s(lm['knee']), 'hips')
        add(f'shin.{side}', s(lm['knee']), s(lm['ankle']), f'thigh.{side}', True)
        add(f'foot.{side}', s(lm['ankle']), s(lm['toe']), f'shin.{side}', True)
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm_obj


def midpoint(a, b):
    return [(a[i] + b[i]) / 2 for i in range(3)]


def key_world_rotation(pose_bone, rest_rot_inv, world_quat, frame):
    """Keyframe a pose rotation expressed as a world-space quaternion."""
    local = rest_rot_inv @ world_quat.to_matrix() @ rest_rot_inv.inverted()
    pose_bone.rotation_mode = 'QUATERNION'
    pose_bone.rotation_quaternion = local.to_quaternion()
    pose_bone.keyframe_insert('rotation_quaternion', frame=frame)


def rest_rot_inverses(arm_obj):
    return {
        pb.name: (arm_obj.matrix_world @ pb.bone.matrix_local).to_3x3().inverted()
        for pb in arm_obj.pose.bones
    }


def world_quat(*axis_angle_pairs):
    """Compose world-space rotations; first pair is applied first."""
    q = Quaternion()
    for axis, angle in axis_angle_pairs:
        q = Quaternion(axis, angle) @ q
    return q


def save_landmarks(lm, path):
    with open(path, 'w') as f:
        json.dump(lm, f, indent=2)
