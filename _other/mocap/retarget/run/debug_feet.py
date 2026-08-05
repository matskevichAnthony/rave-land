"""Per-frame foot clearance of the exported clip, to judge ground contact."""
from pathlib import Path

import bpy

WORK = Path('/home/anton-matzkaim/rave-land/_other/mocap/retarget/run')

scene = bpy.context.scene
scene.render.fps = 30  # before import: the glTF importer maps key times via scene fps
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=str(WORK / 'run.glb'))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
arm.animation_data_create()
arm.animation_data.action = bpy.data.actions[0]

# glTF has no bone tails, the importer invents them for leaf bones like foot.*,
# so only ankle (head) heights are meaningful here.
REST_ANKLE_Z = 0.07875

print('frame  ankle.L  ankle.R   hipz')
for fr in range(24):
    scene.frame_set(fr)
    row = [fr]
    for side in ('L', 'R'):
        pb = arm.pose.bones[f'foot.{side}']
        row.append((arm.matrix_world @ pb.head).z - REST_ANKLE_Z)
    hips = arm.pose.bones['hips']
    row.append((arm.matrix_world @ hips.head).z)
    print('  '.join(f'{v:7.3f}' if not isinstance(v, int) else f'{v:4d}' for v in row))
