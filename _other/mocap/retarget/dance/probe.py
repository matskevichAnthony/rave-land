"""Probe rig rest conventions and BVH poses at several frames for calibration."""
import json
from pathlib import Path

import bpy
from mathutils import Vector

RIG_BLEND = '/home/anton-matzkaim/rave-land/_other/auto-rig/rig.blend'
LANDMARKS = '/home/anton-matzkaim/rave-land/_other/auto-rig/landmarks.json'
BVH = '/home/anton-matzkaim/rave-land/_other/mocap/bandai/dataset-1_dance-short_normal_001.bvh'

bpy.ops.wm.open_mainfile(filepath=RIG_BLEND)
rig = bpy.data.objects['Rig']
print('RIG matrix_world:')
print(rig.matrix_world)
for name in ('hips', 'spine', 'chest', 'neck', 'head', 'upper_arm.L', 'forearm.L',
             'hand.L', 'upper_arm.R', 'thigh.L', 'shin.L', 'foot.L'):
    b = rig.data.bones[name]
    d = (b.tail_local - b.head_local).normalized()
    print(f'RIGBONE {name:12s} head=({b.head_local.x:+.3f},{b.head_local.y:+.3f},'
          f'{b.head_local.z:+.3f}) dir=({d.x:+.2f},{d.y:+.2f},{d.z:+.2f})')
with open(LANDMARKS) as f:
    print('FORWARD', json.load(f)['forward'])

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_anim.bvh(filepath=BVH, global_scale=0.01, use_fps_scale=False)
bvh = bpy.context.view_layer.objects.active
print('BVH object', bvh.name)
print(bvh.matrix_world)
print('BVH bones:', [b.name for b in bvh.data.bones])
action = bvh.animation_data.action
print('frame_range', action.frame_range, 'scene fps', bpy.context.scene.render.fps,
      'scene range', bpy.context.scene.frame_start, bpy.context.scene.frame_end)

PROBE_BONES = ('Hips', 'Spine', 'Chest', 'Neck', 'Head',
               'UpperArm_L', 'LowerArm_L', 'Hand_L', 'UpperArm_R',
               'UpperLeg_L', 'LowerLeg_L', 'Foot_L', 'UpperLeg_R')


def dump(frame):
    bpy.context.scene.frame_set(frame)
    mw = bvh.matrix_world
    print('--- frame', frame)
    for name in PROBE_BONES:
        m = mw @ bvh.pose.bones[name].matrix
        head = m.translation
        d = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
        print(f'{name:12s} head=({head.x:+.3f},{head.y:+.3f},{head.z:+.3f}) '
              f'dir=({d.x:+.2f},{d.y:+.2f},{d.z:+.2f})')
    leg_l = (mw @ bvh.pose.bones['UpperLeg_L'].matrix).translation
    leg_r = (mw @ bvh.pose.bones['UpperLeg_R'].matrix).translation
    left = (leg_l - leg_r).normalized()
    facing = left.cross(Vector((0, 0, 1)))
    print('facing', tuple(round(v, 2) for v in facing))


for fr in (0, 1, 2, 60, 950, 1900, 1901):
    dump(fr)
