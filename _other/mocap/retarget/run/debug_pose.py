"""Numeric check of the retarget: source vs keyed target orientations."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/mocap/retarget/run')
sys.path.insert(0, str(WORK))
sys.path.insert(0, '/home/anton-matzkaim/rave-land/_other/auto-rig')

import retarget_run  # noqa: F401  (runs the whole pipeline in this session)

arm = bpy.data.objects['Rig']
arm.animation_data.action = bpy.data.actions['Run']
scene = bpy.context.scene
print('RIG matrix_world:')
print(arm.matrix_world)

for fr in (0, 6, 12, 18):
    scene.frame_set(fr)
    hips = arm.pose.bones['hips']
    eul = (arm.matrix_world @ hips.matrix).to_euler()
    print(f'\nFRAME {fr}')
    print('  hips pose euler deg', [round(math.degrees(a), 1) for a in eul])
    for name in ('head', 'foot.L', 'foot.R', 'hand.L'):
        pb = arm.pose.bones[name]
        h = arm.matrix_world @ pb.head
        t = arm.matrix_world @ pb.tail
        d = (t - h).normalized()
        print(f'  {name:8s} head z={h.z:6.3f} y={h.y:6.3f}  dir=({d.x:5.2f},{d.y:5.2f},{d.z:5.2f})')

deltas0, _ = retarget_run.frames_data[0]
for bone in ('hips', 'chest', 'thigh.L', 'shin.L', 'foot.L', 'upper_arm.L'):
    e = deltas0[bone].to_euler()
    print(f'D[{bone}] f0 euler deg', [round(math.degrees(a), 1) for a in e])
