"""Inspect the imported BVH: travel direction, pose of frame 0, loop period."""
from pathlib import Path

import bpy
from mathutils import Vector

BVH = Path('/home/anton-matzkaim/rave-land/_other/mocap/bandai/dataset-1_run_normal_001.bvh')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
bpy.ops.import_anim.bvh(filepath=str(BVH), global_scale=0.01,
                        frame_start=0, use_fps_scale=False,
                        update_scene_fps=True, update_scene_duration=True)
src = bpy.context.view_layer.objects.active
print('OBJ', src.name, 'type', src.type, 'matrix_world:')
print(src.matrix_world)
print('scene fps', bpy.context.scene.render.fps,
      'frames', bpy.context.scene.frame_start, bpy.context.scene.frame_end)
print('BONES:')
for b in src.data.bones:
    print(' ', b.name, 'parent', b.parent.name if b.parent else None,
          'head', tuple(round(v, 3) for v in b.head_local),
          'tail', tuple(round(v, 3) for v in b.tail_local))


def world_pos(name):
    pb = src.pose.bones[name]
    return src.matrix_world @ pb.head


JOINTS = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'UpperArm_L', 'LowerArm_L',
          'Hand_L', 'UpperArm_R', 'UpperLeg_L', 'LowerLeg_L', 'Foot_L',
          'Toes_L', 'UpperLeg_R', 'LowerLeg_R', 'Foot_R', 'Toes_R']

frames = range(bpy.context.scene.frame_start, bpy.context.scene.frame_end + 1)
poses = {}
for fr in frames:
    bpy.context.scene.frame_set(fr)
    poses[fr] = {j: world_pos(j).copy() for j in JOINTS}

f0, f_last = min(frames), max(frames)
print('\nHIPS TRACK (world):')
for fr in frames:
    p = poses[fr]['Hips']
    print(f'  f{fr:02d} x={p.x:7.3f} y={p.y:7.3f} z={p.z:7.3f}')

bpy.context.scene.frame_set(f0)
print('\nFRAME 0 pose (world positions):')
for j in JOINTS:
    p = poses[f0][j]
    print(f'  {j:12s} {p.x:7.3f} {p.y:7.3f} {p.z:7.3f}')

print('\nLOOP SIMILARITY vs frame 0 (hips-relative joint positions, sum of dists):')
ref = {j: poses[f0][j] - poses[f0]['Hips'] for j in JOINTS}
for fr in frames:
    rel = {j: poses[fr][j] - poses[fr]['Hips'] for j in JOINTS}
    d = sum((rel[j] - ref[j]).length for j in JOINTS)
    print(f'  f{fr:02d} dist={d:.4f}')
