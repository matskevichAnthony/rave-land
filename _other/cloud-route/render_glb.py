"""Контрольный рендер GLB с четырёх сторон плюс печать статистики меша.

Запуск: blender -b --python render_glb.py -- <вход.glb> <куда-положить.png>
"""
import math
import sys

import bpy
from mathutils import Vector

RESOLUTION = 512
SAMPLES = 16
VIEW_ANGLES = (-90, 0, 90, 180)

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for obj in meshes:
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    print(f'MESH {obj.name}: {len(obj.data.vertices)} vertices, {tris} tris, '
          f'uv={[uv.name for uv in obj.data.uv_layers]}, '
          f'colors={[c.name for c in obj.data.color_attributes]}, '
          f'materials={[m.name for m in obj.data.materials if m]}')
    if obj.data.color_attributes and not obj.data.materials:
        material = bpy.data.materials.new('vertex_colors')
        material.use_nodes = True
        tree = material.node_tree
        attribute = tree.nodes.new('ShaderNodeVertexColor')
        attribute.layer_name = obj.data.color_attributes[0].name
        tree.links.new(attribute.outputs['Color'], tree.nodes['Principled BSDF'].inputs['Base Color'])
        obj.data.materials.append(material)

corners = [obj.matrix_world @ Vector(c) for obj in meshes for c in obj.bound_box]
low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
center = (low + high) / 2
size = max(high - low)
print(f'BBOX {low.x:.3f},{low.y:.3f},{low.z:.3f} .. {high.x:.3f},{high.y:.3f},{high.z:.3f}')

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
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.35, 0.35, 0.4, 1)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
bpy.context.collection.objects.link(camera)
scene.camera = camera
camera.rotation_mode = 'QUATERNION'

for index, angle in enumerate(VIEW_ANGLES):
    radians = math.radians(angle)
    camera.location = center + Vector((math.cos(radians) * size * 1.9,
                                       math.sin(radians) * size * 1.9,
                                       size * 0.25))
    camera.rotation_quaternion = (camera.location - center).to_track_quat('Z', 'Y')
    scene.render.filepath = out.replace('.png', f'-v{index}.png')
    bpy.ops.render.render(write_still=True)
    print('RENDERED', scene.render.filepath)
