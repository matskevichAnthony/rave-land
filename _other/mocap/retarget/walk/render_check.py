"""Render front/side frames of the retargeted clips for visual verification."""
import math
from pathlib import Path

import bpy
from mathutils import Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/mocap/retarget/walk')
WALK_PHASES = 4
OTHER_CLIPS = ('WalkAngry', 'WalkTired', 'WalkFeminine')

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'walk.blend'))
rig = bpy.data.objects['Rig']

sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4
sun.rotation_euler = (math.radians(50), 0, math.radians(30))
bpy.context.collection.objects.link(sun)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 12
scene.cycles.use_denoising = False
scene.render.resolution_x = 512
scene.render.resolution_y = 768
scene.world = bpy.data.worlds.new('W')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = \
    (0.7, 0.7, 0.75, 1)

cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
bpy.context.collection.objects.link(cam)
scene.camera = cam
target = Vector((0, 0, 0.9))
VIEWS = {'front': Vector((0, -3.2, 1.1)), 'side': Vector((3.2, 0, 1.1))}


def clip_length(name):
    strip = next(t.strips[0] for t in rig.animation_data.nla_tracks
                 if t.name == name)
    return int(strip.action_frame_end)


def render(name, frame, view):
    scene.frame_set(frame)
    pos = VIEWS[view]
    cam.location = pos
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (target - pos).to_track_quat('-Z', 'Y')
    scene.render.filepath = str(WORK / f'{name.lower()}-{view}-f{frame:03d}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)


length = clip_length('Walk')
rig.animation_data.action = bpy.data.actions['Walk']
for i in range(WALK_PHASES):
    frame = length * i // WALK_PHASES
    for view in VIEWS:
        render('walk', frame, view)

for name in OTHER_CLIPS:
    rig.animation_data.action = bpy.data.actions[name]
    frame = clip_length(name) // 4
    for view in VIEWS:
        render(name, frame, view)
