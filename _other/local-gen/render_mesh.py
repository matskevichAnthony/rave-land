"""Контрольные ракурсы сырого меша из TripoSR: четыре стороны в одном ряду.

Меш приходит с вершинными цветами и без UV (F-019), поэтому материал собирается
из ноды Color Attribute, иначе в кадре будет ровно белый силуэт.

Флаг --decimate показывает тот же меш, ужатый до бюджета NPC: сырые 40-50 тысяч
треугольников в сцену всё равно не поедут, и судить о годности надо по тому, что
переживёт даунскейл.

    blender --background --python _other/local-gen/render_mesh.py -- <glb> <префикс>
    blender --background --python _other/local-gen/render_mesh.py -- <glb> <префикс> --decimate 3000
"""
import argparse
import math
import sys

import bpy
from mathutils import Vector

RESOLUTION = 512
SAMPLES = 24
VIEWS = {'front': 0, 'side': 90, 'back': 180, 'quarter': 45}


def vertex_color_material():
    mat = bpy.data.materials.new('VertexColor')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.85
    color = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    mat.node_tree.links.new(color.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def import_mesh(glb_path):
    """Импортирует GLB и ставит его на ноги.

    TripoSR кладёт макушку в -Y, а импортёр glTF считает вход Y-up, поэтому
    фигура приезжает лежащей: поворот вокруг X ставит её на ноги, поворот вокруг
    Z доворачивает лицо к -Y, чтобы имена ракурсов не врали.
    Импортёр переводит объекты в кватернионный режим, так что режим приходится
    возвращать, иначе присвоение rotation_euler молча ничего не делает.
    """
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb_path)
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    mat = vertex_color_material()
    for obj in meshes:
        obj.rotation_mode = 'XYZ'
        obj.rotation_euler = (-math.pi / 2, 0, -math.pi / 2)
        obj.data.materials.clear()
        obj.data.materials.append(mat)
    bpy.context.view_layer.update()
    return meshes


def decimate(meshes, target_triangles):
    """Ужимает меш до бюджета сцены, как это делает шаг 2 маршрута A."""
    before = sum(len(obj.data.polygons) for obj in meshes)
    for obj in meshes:
        modifier = obj.modifiers.new('Decimate', 'DECIMATE')
        modifier.ratio = min(1.0, target_triangles / before)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    after = sum(len(obj.data.polygons) for obj in meshes)
    print(f'DECIMATED {before} -> {after} треугольников')


def bounds(meshes):
    corners = [obj.matrix_world @ Vector(corner) for obj in meshes for corner in obj.bound_box]
    low = Vector((min(c[i] for c in corners) for i in range(3)))
    high = Vector((max(c[i] for c in corners) for i in range(3)))
    return low, high


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('glb')
    parser.add_argument('prefix')
    parser.add_argument('--decimate', type=int, help='бюджет треугольников перед рендером')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    prefix = args.prefix

    meshes = import_mesh(args.glb)
    if args.decimate:
        decimate(meshes, args.decimate)
    low, high = bounds(meshes)
    center = (low + high) / 2
    radius = max(high - low) * 1.4

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = SAMPLES
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.world = bpy.data.worlds.new('W')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.5, 0.55, 1)

    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3
    sun.rotation_euler = (math.radians(55), 0, math.radians(30))
    bpy.context.collection.objects.link(sun)

    camera = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = radius
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    camera.rotation_mode = 'QUATERNION'

    for name, yaw in VIEWS.items():
        angle = math.radians(yaw)
        camera.location = center + Vector((math.sin(angle), -math.cos(angle), 0.15)) * radius
        camera.rotation_quaternion = (camera.location - center).to_track_quat('Z', 'Y')
        scene.render.filepath = f'{prefix}-{name}.png'
        bpy.ops.render.render(write_still=True)
        print('RENDERED', scene.render.filepath)


main()
