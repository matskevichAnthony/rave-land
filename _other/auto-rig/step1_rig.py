"""Import the TRELLIS GLB, build an armature from geometry and skin it."""
import sys
from pathlib import Path

import bpy

WORK = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')
sys.path.insert(0, str(WORK))
import rig_lib

GLB_IN = '/home/anton-matzkaim/rave-land/_other/sample_2026-07-29T160343.702.glb'

obj = rig_lib.import_and_normalize(GLB_IN)
lm = rig_lib.detect_landmarks(obj)
rig_lib.save_landmarks(lm, str(WORK / 'landmarks.json'))
print('LANDMARKS', lm)

arm_obj = rig_lib.build_armature(lm)

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj
try:
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    print('AUTO_WEIGHTS_OK')
except RuntimeError as exc:
    print('AUTO_WEIGHTS_FAILED', exc)

groups_with_weights = 0
for vg in obj.vertex_groups:
    groups_with_weights += 1
print('VERTEX_GROUPS', len(obj.vertex_groups))

import numpy as np
mesh = obj.data
counts = np.zeros(len(mesh.vertices), dtype=np.int32)
for i, vert in enumerate(mesh.vertices):
    counts[i] = sum(1 for g in vert.groups if g.weight > 0.001)
unweighted = int((counts == 0).sum())
print('UNWEIGHTED_VERTS', unweighted, 'of', len(mesh.vertices))

bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'rig.blend'))
print('SAVED rig.blend')
