"""Import run.glb and render front/side views at several phases of the cycle."""
import math
from pathlib import Path

import bpy
from mathutils import Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/mocap/retarget/run')
CHECK_FRAMES = (0, 4, 8, 12, 17, 20)

scene = bpy.context.scene
scene.render.fps = 30  # before import: the glTF importer maps key times via scene fps
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=str(WORK / 'run.glb'))
arm_obj = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
print('ACTIONS', sorted(a.name for a in bpy.data.actions))
action = bpy.data.actions[0]
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
bpy.context.collection.objects.link(sun)

floor_mesh = bpy.data.meshes.new('Floor')
floor_mesh.from_pydata([(-4, -4, 0), (4, -4, 0), (4, 4, 0), (-4, 4, 0)], [], [(0, 1, 2, 3)])
floor = bpy.data.objects.new('Floor', floor_mesh)
bpy.context.collection.objects.link(floor)

scene.render.engine = 'CYCLES'
scene.cycles.samples = 12
scene.cycles.use_denoising = False
scene.render.resolution_x = 512
scene.render.resolution_y = 768
scene.world = bpy.data.worlds.new('W')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.7, 0.7, 0.75, 1)

cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
bpy.context.collection.objects.link(cam)
scene.camera = cam
target = Vector((0, 0, 0.9))
VIEWS = {
    'front': Vector((0.0, -3.4, 1.1)),
    'side': Vector((3.4, 0.0, 1.1)),
}

arm_obj.animation_data_create()
arm_obj.animation_data.action = action
for fr in CHECK_FRAMES:
    scene.frame_set(fr)
    for view, pos in VIEWS.items():
        cam.location = pos
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = (target - pos).to_track_quat('-Z', 'Y')
        scene.render.filepath = str(WORK / f'check-{view}-f{fr:02d}.png')
        bpy.ops.render.render(write_still=True)
        print('RENDERED', view, fr)
