"""Import the final GLB and render mid-clip frames to prove skin and clips survived."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')
GLB = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else str(WORK / 'character-animated.glb')

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=GLB)

arm_obj = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
clips = {a.name.split('_')[0]: a for a in bpy.data.actions}
print('IMPORTED ACTIONS', sorted(a.name for a in bpy.data.actions))

scene = bpy.context.scene
scene.render.fps = 30
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
bpy.context.collection.objects.link(sun)
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
    'front': Vector((0.6, -3.2, 1.2)),
    'side': Vector((3.2, -0.6, 1.2)),
}

arm_obj.animation_data_create()
for name, action in clips.items():
    arm_obj.animation_data.action = action
    scene.frame_set(int(action.frame_range[1] // 2))
    for view, pos in VIEWS.items():
        cam.location = pos
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = (target - pos).to_track_quat('-Z', 'Y')
        scene.render.filepath = str(WORK / f'final-{name.lower()}-{view}.png')
        bpy.ops.render.render(write_still=True)
print('VERIFY RENDERS DONE')
