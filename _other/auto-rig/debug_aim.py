"""Print world-space bone directions at the middle of the Aim clip."""
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')
sys.path.insert(0, str(WORK))
import anim_lib

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'rig.blend'))
arm_obj = bpy.data.objects['Rig']
with open(WORK / 'landmarks.json') as f:
    lm = json.load(f)

builder = anim_lib.ClipBuilder(arm_obj, lm['forward'])
n = anim_lib.build_aim(builder)
bpy.context.scene.frame_set(n // 2)
bpy.context.view_layer.update()
for name in ('hips', 'chest', 'upper_arm.R', 'forearm.R', 'hand.R',
             'upper_arm.L', 'forearm.L'):
    pb = arm_obj.pose.bones[name]
    d = (pb.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
    r = (pb.bone.matrix_local.to_3x3() @ Vector((0, 1, 0))).normalized()
    print(f'{name:14s} rest=({r.x:+.2f},{r.y:+.2f},{r.z:+.2f}) '
          f'pose=({d.x:+.2f},{d.y:+.2f},{d.z:+.2f})')
