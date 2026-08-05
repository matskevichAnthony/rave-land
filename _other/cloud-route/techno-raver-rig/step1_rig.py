"""Импорт подготовленного меша, нормализация, лендмарки, скелет из 17 костей."""
import sys
from pathlib import Path

import bpy

WORK = Path(__file__).resolve().parent
sys.path.insert(0, str(WORK))
import rig_lib

GLB_IN = WORK.parent / 'techno-raver-prepped.glb'

obj = rig_lib.import_and_normalize(str(GLB_IN))
print('MESH_VERTS', len(obj.data.vertices))
print('MESH_TRIS', sum(len(p.vertices) - 2 for p in obj.data.polygons))

landmarks = rig_lib.detect_landmarks(obj)
rig_lib.save_landmarks(landmarks, str(WORK / 'landmarks.json'))
print('LANDMARKS', landmarks)

rig_lib.build_armature(landmarks)

bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'rig.blend'))
print('SAVED rig.blend')
