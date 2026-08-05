"""Assign nearest-bone weights to vertices the proxy transfer missed."""
from pathlib import Path

import bpy
import numpy as np

WORK = Path(__file__).resolve().parent

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'rig.blend'))
obj = bpy.data.objects['Character']
arm_obj = bpy.data.objects['Rig']

unweighted = [
    v.index for v in obj.data.vertices
    if not any(g.weight > 0.001 for g in v.groups)
]
print('UNWEIGHTED', len(unweighted))
if unweighted:
    coords = np.array([obj.data.vertices[i].co for i in unweighted])
    print('BBOX_MIN', coords.min(axis=0))
    print('BBOX_MAX', coords.max(axis=0))

    bones = [(b.name, np.array(b.head_local), np.array(b.tail_local))
             for b in arm_obj.data.bones]

    def seg_dist(points, head, tail):
        d = tail - head
        t = np.clip(((points - head) @ d) / (d @ d), 0.0, 1.0)
        closest = head + t[:, None] * d
        return np.linalg.norm(points - closest, axis=1)

    dists = np.stack([seg_dist(coords, h, t) for _, h, t in bones])
    nearest = dists.argmin(axis=0)
    for bone_idx in np.unique(nearest):
        name = bones[bone_idx][0]
        vg = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        idxs = [unweighted[i] for i in np.flatnonzero(nearest == bone_idx)]
        vg.add(idxs, 1.0, 'REPLACE')
        print('ASSIGNED', len(idxs), 'to', name)

    still = sum(
        1 for v in obj.data.vertices
        if not any(g.weight > 0.001 for g in v.groups)
    )
    print('STILL_UNWEIGHTED', still)
    bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'rig.blend'))
    print('SAVED')
