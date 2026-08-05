"""Диагностика: крупный план головы и торса, с текстурой и без неё.

Запуск: blender -b --python diag_head.py -- <вход.glb> <префикс-вывода>
"""
import math
import sys

import bpy
from mathutils import Vector

RESOLUTION = 640
SAMPLES = 24

argv = sys.argv[sys.argv.index('--') + 1:]
src, prefix = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
corners = [obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
top = max(c.z for c in corners)
head = Vector((0, 0, top * 0.92))

sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 4
sun.rotation_euler = (math.radians(55), 0, math.radians(35))
bpy.context.collection.objects.link(sun)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = False
scene.render.resolution_x = RESOLUTION
scene.render.resolution_y = RESOLUTION
scene.world = bpy.data.worlds.new('World')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.45, 0.5, 1)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
bpy.context.collection.objects.link(camera)
scene.camera = camera
camera.rotation_mode = 'QUATERNION'
camera.data.lens = 85

flat = bpy.data.materials.new('flat')
flat.use_nodes = True
flat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.85


def shoot(name, offset, target, textured):
    if not textured:
        for obj in meshes:
            obj.data.materials.clear()
            obj.data.materials.append(flat)
    camera.location = target + offset
    camera.rotation_quaternion = (camera.location - target).to_track_quat('Z', 'Y')
    scene.render.filepath = f'{prefix}-{name}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)


materials = [[m for m in obj.data.materials] for obj in meshes]
for name, offset in (('head-front', Vector((0, -0.65, 0.06))),
                     ('head-side', Vector((0.65, -0.15, 0.06))),
                     ('head-back', Vector((0, 0.65, 0.06)))):
    shoot(name, offset, head, True)
    for obj, mats in zip(meshes, materials):
        obj.data.materials.clear()
        for material in mats:
            obj.data.materials.append(material)

shoot('geometry-front', Vector((0, -0.7, 0.05)), head, False)
shoot('geometry-side', Vector((0.7, -0.1, 0.05)), head, False)
