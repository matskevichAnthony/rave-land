"""Verify retarget output: loop cut points, foot-floor contact, GLB contents."""
import sys
from pathlib import Path

import bpy
import numpy as np

WORK = Path('/home/anton-matzkaim/rave-land/_other/mocap/retarget/dance')
sys.path.insert(0, str(WORK))
from retarget_dance import (BVH_DIR, CALIB_FRAME, CLIPS, find_loop,
                            retarget_worlds, rig_rest, sample_bvh)

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'retarget.blend'))
rest = rig_rest(bpy.data.objects['Rig'])
hips_rest_z = float(bpy.data.objects['Rig'].data.bones['hips'].head_local.z)

for name, bvh, l_min, l_max in CLIPS:
    sample = sample_bvh(BVH_DIR / bvh)
    world, _ = retarget_worlds(sample, rest)
    scale = hips_rest_z / sample['hips'][CALIB_FRAME - 1][2]
    dz = (sample['hips'][:, 2] - sample['hips'][CALIB_FRAME - 1][2]) * scale
    start, length = find_loop(world, dz, sample['hips'][:, :2], l_min, l_max)
    print(f'CUT {name}: src frames {start}..{start + length} '
          f'({start / 30:.1f}s..{(start + length) / 30:.1f}s of take)')

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'retarget.blend'))
rig = bpy.data.objects['Rig']
scene = bpy.context.scene
for action in bpy.data.actions:
    rig.animation_data.action = action
    length = int(action.frame_range[1])
    foot_z, hips_z = [], []
    for f in range(0, length + 1):
        scene.frame_set(f)
        foot_z.append(min((rig.matrix_world @ rig.pose.bones[b].tail).z
                          for b in ('foot.L', 'foot.R')))
        hips_z.append((rig.matrix_world @ rig.pose.bones['hips'].head).z)
    foot_z, hips_z = np.array(foot_z), np.array(hips_z)
    first_last = np.abs(foot_z[0] - foot_z[-1])
    print(f'FLOOR {action.name}: lowest-foot-tip z min={foot_z.min():+.3f} '
          f'mean={foot_z.mean():+.3f} max={foot_z.max():+.3f}; '
          f'hips z {hips_z.min():.3f}..{hips_z.max():.3f}; '
          f'|first-last| foot={first_last:.4f}')
    rig.animation_data.action = None

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(WORK / 'dance.glb'))
for obj in bpy.context.scene.objects:
    print('GLB object:', obj.name, obj.type)
for action in bpy.data.actions:
    span = action.frame_range
    print(f'GLB action {action.name}: frames {span[0]:.0f}..{span[1]:.0f} '
          f'({(span[1] - span[0]) / 30:.2f}s @30fps), '
          f'{len(action.fcurves)} fcurves')
print('GLB size bytes:', (WORK / 'dance.glb').stat().st_size)
