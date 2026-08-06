"""Скелет по геометрии: импорт подготовленного меша, нормализация, лендмарки, 17 костей.

Запуск: blender -b --python step1_rig.py -- <каталог-рига> <подготовленный.glb>
"""
import sys
from pathlib import Path

import bpy

WORK = Path(__file__).resolve().parent
sys.path.insert(0, str(WORK))
sys.path.insert(0, str(WORK.parent / 'auto-rig'))
import rig_lib
from route import FRONT_AXIS_SIGN

argv = sys.argv[sys.argv.index('--') + 1:]
rig_dir, source = Path(argv[0]).resolve(), argv[1]
rig_dir.mkdir(parents=True, exist_ok=True)

obj = rig_lib.import_and_normalize(source)
print('MESH_VERTS', len(obj.data.vertices))
print('MESH_TRIS', sum(len(p.vertices) - 2 for p in obj.data.polygons))

landmarks = rig_lib.detect_landmarks(obj)
if landmarks['forward'] != FRONT_AXIS_SIGN:
    # Детект переда в rig_lib смотрит, какой край стопы дальше от лодыжки, и на
    # массивной подошве принимает пятку за носок: стопа и все клипы уезжают на 180.
    print(f'FORWARD detected {landmarks["forward"]}, forced to {FRONT_AXIS_SIGN}')
    ankle_y = landmarks['ankle'][1]
    landmarks['toe'][1] = ankle_y + FRONT_AXIS_SIGN * abs(landmarks['toe'][1] - ankle_y)
    landmarks['forward'] = FRONT_AXIS_SIGN
rig_lib.save_landmarks(landmarks, str(rig_dir / 'landmarks.json'))
print('LANDMARKS', landmarks)

rig_lib.build_armature(landmarks)

bpy.ops.wm.save_as_mainfile(filepath=str(rig_dir / 'rig.blend'))
print('SAVED', rig_dir / 'rig.blend')
