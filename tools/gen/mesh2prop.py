#!/usr/bin/env python3
"""Сырой меш генератора в игровой проп: оси, бюджет треугольников, метры, PS1-текстура.

TripoSR отдаёт десятки тысяч треугольников в своих осях, без UV, без масштаба и
без посадки на землю. Здесь этот меш становится пропом сцены: поворот в оси игры,
decimate до жёсткого бюджета, вершинные цвета запекаются в крошечную текстуру с
ближайшей фильтрацией (это и есть вид первой PlayStation), масштаб в метры и
осадка подошвы на ноль, как у процедурных пропов из props.py.

Бюджет треугольников тут не пожелание, а вход: «сколько получится» даёт модели на
десятки тысяч треугольников, которые сцену не тянут.

Использование:
    BLENDER=_other/auto-rig/blender-4.2.9-linux-x64/blender
    $BLENDER --background --python tools/gen/mesh2prop.py -- \\
        _other/local-gen/out/sandbags.glb public/assets/models/sandbags.glb \\
        --kind prop --preview sandbags.png --stats sandbags.json
"""
import argparse
import json
import math
import sys
import time
from collections import namedtuple
from pathlib import Path

import bpy
from mathutils import Vector

# TripoSR отдаёт меш в своих осях, та же поправка стоит в _other/local-gen/render_mesh.py.
TRIPOSR_FIX = (-math.pi / 2, 0, -math.pi / 2)

Kind = namedtuple('Kind', ('triangles', 'size', 'fit', 'title'))

# Габарит меряется по одной оси: предмет узнаётся по ширине, персонаж по росту.
KINDS = {
    'prop': Kind(1200, 1.4, 'x', 'Предмет'),
    'character': Kind(4000, 1.8, 'z', 'Персонаж'),
}

TEXTURE_SIZE = 64
SMOOTH_ANGLE = math.radians(40)
ROUGHNESS = 0.95
UNWRAP_ANGLE = math.radians(66)
ISLAND_MARGIN = 0.03
BAKE_MARGIN = 2
PREVIEW_SIZE = 640
PREVIEW_SAMPLES = 24
BACKGROUND = (0.05, 0.05, 0.07, 1)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_meshes(source):
    bpy.ops.import_scene.gltf(filepath=str(source))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    if not meshes:
        raise SystemExit(f'в {source} нет ни одного меша')
    return meshes


def orient_and_join(objects):
    """Поворот в оси игры и склейка в один объект: проп это одна модель, а не набор кусков."""
    for obj in objects:
        obj.rotation_mode = 'XYZ'
        obj.rotation_euler = TRIPOSR_FIX
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    if len(objects) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def triangles(obj):
    evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    count = len(mesh.loop_triangles) or sum(len(p.vertices) - 2 for p in mesh.polygons)
    evaluated.to_mesh_clear()
    return count


def decimate(obj, budget):
    before = triangles(obj)
    if before <= budget:
        return before, before
    modifier = obj.modifiers.new('Decimate', 'DECIMATE')
    modifier.ratio = budget / before
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    return before, triangles(obj)


def vertex_color_material(obj):
    """Материал по вершинным цветам: TripoSR красит вершины, UV у него нет."""
    material = bpy.data.materials.new('Prop')
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = ROUGHNESS
    obj.data.materials.clear()
    obj.data.materials.append(material)

    if not obj.data.color_attributes:
        return material, None
    source = material.node_tree.nodes.new('ShaderNodeVertexColor')
    source.layer_name = obj.data.color_attributes[0].name
    material.node_tree.links.new(bsdf.inputs['Base Color'], source.outputs['Color'])
    return material, source


def unwrap(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=UNWRAP_ANGLE, island_margin=ISLAND_MARGIN)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_vertex_colors(obj, material, source, size):
    """Вершинные цвета в текстуру size x size с ближайшей фильтрацией.

    Вершинный цвет живёт только в геометрии: сдекимированный меш теряет его вместе
    с вершинами, а движок не может ни подменить, ни переиспользовать такую окраску.
    Запечённая крошечная текстура с ближайшей фильтрацией и дешевле, и даёт ровно
    ту крупную мыльную пиксельность, ради которой всё затевалось.
    """
    unwrap(obj)
    image = bpy.data.images.new('PropTexture', size, size, alpha=False)
    tree = material.node_tree
    target = tree.nodes.new('ShaderNodeTexImage')
    target.image = image
    target.interpolation = 'Closest'
    tree.nodes.active = target

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 1
    scene.render.bake.margin = BAKE_MARGIN
    scene.render.bake.use_selected_to_active = False
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True)

    tree.links.new(tree.nodes['Principled BSDF'].inputs['Base Color'], target.outputs['Color'])
    tree.nodes.remove(source)
    image.pack()
    obj.data.color_attributes.remove(obj.data.color_attributes[0])
    return image


def scale_to_size(obj, kind, size):
    """Габарит по опорной оси в метрах: масштаб всегда равномерный, пропорции меша чужие."""
    current = getattr(obj.dimensions, kind.fit)
    if current <= 0:
        raise SystemExit(f'меш плоский по оси {kind.fit}, масштабировать нечего')
    obj.scale = [size / current] * 3
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)


def place_on_ground(obj):
    """Origin в центре подошвы: игра ставит модель на рельеф по origin (src/objects/registry.js)."""
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    obj.location -= Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z))
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)


def export(obj, output):
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=str(output), export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True,
    )


def render_preview(obj, output):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = PREVIEW_SAMPLES
    scene.cycles.use_denoising = False
    scene.render.resolution_x = PREVIEW_SIZE
    scene.render.resolution_y = PREVIEW_SIZE
    output.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(output)

    scene.world = bpy.data.worlds.new('World')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = BACKGROUND

    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(55), 0, math.radians(35))
    bpy.context.collection.objects.link(sun)

    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    target = obj.location + Vector((0, 0, obj.dimensions.z / 2))
    reach = max(obj.dimensions) * 2.0
    camera.location = target + Vector((reach * 0.7, -reach, reach * 0.55))
    camera.rotation_mode = 'QUATERNION'
    camera.rotation_quaternion = (camera.location - target).to_track_quat('Z', 'Y')
    bpy.ops.render.render(write_still=True)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('source', type=Path, help='сырой GLB генератора мешей')
    p.add_argument('output', type=Path, help='куда положить готовый проп')
    p.add_argument('--kind', choices=KINDS, default='prop', help='умолчания бюджета и габарита')
    p.add_argument('--triangles', type=int, help='бюджет треугольников поверх умолчания типа')
    p.add_argument('--size', type=float, help='целевой габарит в метрах поверх умолчания типа')
    p.add_argument('--texture', type=int, default=TEXTURE_SIZE,
                   help='сторона запечённой текстуры, 0 оставляет вершинные цвета')
    p.add_argument('--preview', type=Path, help='куда положить контрольный кадр PNG')
    p.add_argument('--stats', type=Path, help='куда положить цифры прогона в JSON')
    return p.parse_args(argv)


def main():
    args = parse_args()
    started = time.time()
    kind = KINDS[args.kind]
    budget = args.triangles or kind.triangles
    size = args.size or kind.size

    clear_scene()
    obj = orient_and_join(import_meshes(args.source))
    print(f'меш загружен: {args.source}', flush=True)

    before, after = decimate(obj, budget)
    print(f'бюджет {budget}: {before} -> {after} треугольников', flush=True)

    material, source = vertex_color_material(obj)
    baked = args.texture and source and bake_vertex_colors(obj, material, source, args.texture)
    print(f'цвет: текстура {args.texture}x{args.texture}, ближайшая фильтрация' if baked
          else 'цвет: вершинные цвета без текстуры', flush=True)

    bpy.ops.object.shade_auto_smooth(angle=SMOOTH_ANGLE)
    scale_to_size(obj, kind, size)
    place_on_ground(obj)
    export(obj, args.output)

    width, height, depth = (round(value, 2) for value in
                            (obj.dimensions.x, obj.dimensions.z, obj.dimensions.y))
    kilobytes = round(args.output.stat().st_size / 1024)
    print(f'готово: {after} треугольников, габариты {width} x {height} x {depth} м, '
          f'{kilobytes} КБ -> {args.output}', flush=True)

    if args.stats:
        args.stats.parent.mkdir(parents=True, exist_ok=True)
        args.stats.write_text(json.dumps({
            'kind': args.kind,
            'file': args.output.name,
            'triangles': after,
            'triangles_source': before,
            'budget': budget,
            'texture': args.texture if baked else 0,
            'kilobytes': kilobytes,
            'size': [width, height, depth],
            'seconds': round(time.time() - started, 1),
        }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    if args.preview:
        render_preview(obj, args.preview)
        print(f'контрольный кадр {args.preview}', flush=True)


if __name__ == '__main__':
    main()
