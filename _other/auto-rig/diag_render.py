"""Render diagnostic views: character mesh plus bone sticks, front and side."""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

WORK = Path('/home/anton-matzkaim/rave-land/_other/auto-rig')

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'rig.blend'))
arm_obj = bpy.data.objects['Rig']

bone_mat = bpy.data.materials.new('BoneStick')
bone_mat.use_nodes = True
bsdf = bone_mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (1, 0, 0, 1)
bsdf.inputs['Emission Color'].default_value = (1, 0.1, 0.1, 1)
bsdf.inputs['Emission Strength'].default_value = 2.0

for bone in arm_obj.data.bones:
    head = arm_obj.matrix_world @ bone.head_local
    tail = arm_obj.matrix_world @ bone.tail_local
    vec = tail - head
    mid = (head + tail) / 2
    bpy.ops.mesh.primitive_cylinder_add(radius=0.012, depth=vec.length, location=mid)
    stick = bpy.context.view_layer.objects.active
    stick.rotation_mode = 'QUATERNION'
    stick.rotation_quaternion = vec.to_track_quat('Z', 'Y')
    stick.data.materials.append(bone_mat)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.02, location=head)
    joint = bpy.context.view_layer.objects.active
    joint.data.materials.append(bone_mat)

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
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.7, 0.7, 0.75, 1)

cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
bpy.context.collection.objects.link(cam)
scene.camera = cam
target = Vector((0, 0, 0.9))

for name, pos in (('front', Vector((0, -3.2, 1.1))), ('side', Vector((3.2, 0, 1.1)))):
    cam.location = pos
    direction = target - pos
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = direction.to_track_quat('-Z', 'Y')
    scene.render.filepath = str(WORK / f'diag_{name}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', name)
