"""Build the five clips, decimate the mesh, export GLB, render mid-clip previews."""
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')
sys.path.insert(0, str(WORK))
import anim_lib

TARGET_TRIS = 32000
PREVIEW_NAME = {'Idle': 'idle2', 'Walk': 'walk2', 'Run': 'run2', 'Aim': 'aim', 'Dance': 'dance'}
# Dance is sampled at a knee-bounce peak; its exact midpoint is the neutral phase.
PREVIEW_FRACTION = {'Dance': 0.375}

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'rig.blend'))
arm_obj = bpy.data.objects['Rig']
mesh_obj = bpy.data.objects['Character']
with open(WORK / 'landmarks.json') as f:
    lm = json.load(f)

lengths = anim_lib.build_all(arm_obj, lm['forward'])
print('CLIPS', lengths)

tris = sum(len(p.vertices) - 2 for p in mesh_obj.data.polygons)
decimate = mesh_obj.modifiers.new('Decimate', 'DECIMATE')
decimate.ratio = TARGET_TRIS / tris
decimate.use_collapse_triangulate = True
mesh_obj.modifiers.move(mesh_obj.modifiers.find('Decimate'), 0)
# Apply destructively (rig.blend on disk stays intact): a live Decimate in the
# stack re-evaluates 279k tris on every sampled animation frame during export.
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_obj
bpy.ops.object.modifier_apply(modifier='Decimate')
print('DECIMATED to', sum(len(p.vertices) - 2 for p in mesh_obj.data.polygons),
      'tris from', tris)

scene = bpy.context.scene
scene.render.fps = 30
scene.frame_start = 0

bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(
    filepath=str(WORK / 'character-animated.glb'),
    export_format='GLB',
    export_apply=True,
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_force_sampling=True,
    export_frame_range=True,
    export_yup=True,
)
print('EXPORTED GLB')

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

for clip, frames in lengths.items():
    arm_obj.animation_data.action = bpy.data.actions[clip]
    scene.frame_set(int(frames * PREVIEW_FRACTION.get(clip, 0.5)))
    for view, pos in VIEWS.items():
        cam.location = pos
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = (target - pos).to_track_quat('-Z', 'Y')
        suffix = '' if view == 'front' else '-side'
        scene.render.filepath = str(WORK / f'{PREVIEW_NAME[clip]}{suffix}.png')
        bpy.ops.render.render(write_still=True)
    arm_obj.animation_data.action = None
print('RENDERED PREVIEWS')
