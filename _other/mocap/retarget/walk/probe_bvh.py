"""Probe imported BVH: joint world axes and hips trajectory, to calibrate retargeting."""
import bpy
from mathutils import Vector

BVH = '/home/anton-matzkaim/rave-land/_other/mocap/bandai/dataset-1_walk_normal_001.bvh'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_anim.bvh(filepath=BVH, global_scale=0.01, frame_start=0,
                        use_fps_scale=False, update_scene_fps=True,
                        update_scene_duration=True)
arm = bpy.context.view_layer.objects.active
print('BVH_OBJECT', arm.name, 'bones:', len(arm.pose.bones))
print('SCENE fps', bpy.context.scene.render.fps, 'range',
      bpy.context.scene.frame_start, bpy.context.scene.frame_end)

for b in arm.data.bones:
    print('BONE', b.name, 'parent', b.parent.name if b.parent else None,
          'head', tuple(round(v, 3) for v in b.head_local),
          'tail', tuple(round(v, 3) for v in b.tail_local))


def dump_frame(f):
    bpy.context.scene.frame_set(f)
    print('=== FRAME', f)
    for pb in arm.pose.bones:
        m = (arm.matrix_world @ pb.matrix)
        loc = m.to_translation()
        r = m.to_3x3()
        cols = [tuple(round(r[i][j], 2) for i in range(3)) for j in range(3)]
        print(pb.name, 'pos', tuple(round(v, 3) for v in loc),
              'X', cols[0], 'Y', cols[1], 'Z', cols[2])


for f in (0, 30, 60):
    dump_frame(f)

print('HIPS_TRAJ')
for f in range(0, 195, 10):
    bpy.context.scene.frame_set(f)
    p = (arm.matrix_world @ arm.pose.bones['Hips'].matrix).to_translation()
    print(f, tuple(round(v, 3) for v in p))
