"""Import the bold-raver GLB, normalize, detect landmarks, build the armature."""
import sys
from pathlib import Path

import bpy

WORK = Path('/home/anton-matzkaim/rave-land/_other/bold-raver-rig')
LIB = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')
sys.path.insert(0, str(LIB))
import rig_lib

GLB_IN = '/home/anton-matzkaim/Downloads/bold-raver.glb'

obj = rig_lib.import_and_normalize(GLB_IN)
print('MESH_VERTS', len(obj.data.vertices))
print('MESH_TRIS', sum(len(p.vertices) - 2 for p in obj.data.polygons))

lm = rig_lib.detect_landmarks(obj)
rig_lib.save_landmarks(lm, str(WORK / 'landmarks.json'))
print('LANDMARKS', lm)

arm_obj = rig_lib.build_armature(lm)

bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'rig.blend'))
print('SAVED rig.blend')
