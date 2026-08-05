#!/usr/bin/env python3
"""Процедурные лоу-поли пропы рейв-сцены (Blender headless, без ИИ и без облака).

Пропы это не персонажи: у них нет скелета, анатомии и анимаций, поэтому весь
маршрут «картинка -> меш -> риг» им не нужен. Ящик, бочка, стек колонок и
ограждение собираются из примитивов за секунды, детерминированно по сиду и
сразу в бюджете PS1-эстетики (сотни треугольников, плоские нормали).

Использование:
    BLENDER=_other/auto-rig/blender-4.2.9-linux-x64/blender
    $BLENDER --background --python tools/gen/props.py -- --prop crate \\
        --out public/assets/models/props/crate.glb --seed 3 --render crate.png
    $BLENDER --background --python tools/gen/props.py -- --prop all \\
        --out-dir public/assets/models/props

Готовый GLB кладётся в мир как обычная модель (`public/world.json`):
    { "id": "crate-1", "type": "model", "src": "assets/models/props/crate.glb",
      "position": [4, null, -6], "rotation": [0, 0.4, 0], "scale": [1, 1, 1] }
Коллайдер для `type: model` считается по bbox автоматически (src/objects/registry.js).
"""
import argparse
import math
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

# Неоновые акценты продублированы из src/config.js (NEON_COLORS): Blender не умеет
# читать ES-модуль игры, а расходиться палитрам нельзя, иначе пропы выпадут из сцены.
NEON_COLORS = ('#ff2fd6', '#00ffd0', '#7b5cff', '#ffe14d', '#00a8ff')

CABINET = '#1c1a26'
METAL = '#2a2735'
PLYWOOD = '#6b563c'
RUST = '#5c3b2a'
DRUM = '#3f4a44'

RENDER_SAMPLES = 12
RENDER_SIZE = 640


def srgb_to_linear(channel):
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def hex_to_linear(color, jitter=0.0, rng=None):
    """Переводит sRGB-хекс в линейный RGBA Blender, опционально чуть меняя яркость."""
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    if jitter and rng:
        shift = rng.uniform(-jitter, jitter)
        rgb = [min(1.0, max(0.0, channel + shift)) for channel in rgb]
    return tuple(srgb_to_linear(channel) for channel in rgb) + (1.0,)


def material(name, color, emission=0.0):
    existing = bpy.data.materials.get(name)
    if existing:
        return existing
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = 0.9
    bsdf.inputs['Metallic'].default_value = 0.0
    if emission:
        bsdf.inputs['Emission Color'].default_value = color
        bsdf.inputs['Emission Strength'].default_value = emission
    return mat


def finish(obj, mat):
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.data.materials.append(mat)
    obj.data.shade_flat()
    return obj


def box(size, location, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.scale = size
    return finish(obj, mat)


def cylinder(radius, depth, location, mat, vertices=10, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation,
    )
    return finish(bpy.context.object, mat)


def ring(major, minor, location, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major, minor_radius=minor, major_segments=16, minor_segments=6,
        location=location, rotation=rotation,
    )
    return finish(bpy.context.object, mat)


def build_speaker_stack(rng):
    """Стек концертных кабинетов с неоновым кольцом, ориентир на buildSpeaker в игре."""
    cabinet = material('cabinet', hex_to_linear(CABINET))
    metal = material('metal', hex_to_linear(METAL))
    neon_color = hex_to_linear(rng.choice(NEON_COLORS))
    neon = material(f'neon-{neon_color[0]:.3f}', neon_color, emission=3.0)

    box((2.0, 1.35, 0.18), (0, 0, 0.09), metal)
    height = 0.18
    for width, depth, tall in ((1.7, 1.15, 1.2), (1.45, 1.0, 0.95), (1.15, 0.85, 0.75)):
        box((width, depth, tall), (0, 0, height + tall / 2), cabinet)
        cone_radius = min(width, tall) * 0.3
        cylinder(
            cone_radius, 0.1, (0, -depth / 2, height + tall / 2), metal,
            vertices=12, rotation=(math.pi / 2, 0, 0),
        )
        for side in (-1, 1):
            box((0.08, 0.06, tall * 0.7), (side * width / 2, 0, height + tall / 2), metal)
        height += tall

    top = height - 0.4
    ring(0.42, 0.05, (0, -0.44, top), neon, rotation=(math.pi / 2, 0, 0))


def build_crate(rng):
    """Фанерный ящик с накладными рёбрами, лёгкий разброс пропорций по сиду."""
    plywood = material('plywood', hex_to_linear(PLYWOOD, jitter=0.05, rng=rng))
    metal = material('metal', hex_to_linear(METAL))

    side = rng.uniform(0.85, 1.1)
    tall = side * rng.uniform(0.8, 1.0)
    box((side, side, tall), (0, 0, tall / 2), plywood)

    rib = 0.07
    edge = side / 2 - rib / 2
    for level in (rib / 2, tall - rib / 2):
        for direction in (-1, 1):
            box((side, rib, rib), (0, direction * edge, level), metal)
            box((rib, side, rib), (direction * edge, 0, level), metal)


def build_barrel(rng):
    """Бочка с двумя обручами: половина ржавая, половина индустриально-зелёная."""
    body_color = RUST if rng.random() < 0.5 else DRUM
    body = material(f'barrel-{body_color}', hex_to_linear(body_color, jitter=0.04, rng=rng))
    metal = material('metal', hex_to_linear(METAL))

    radius = 0.34
    tall = 0.92
    cylinder(radius, tall, (0, 0, tall / 2), body, vertices=12)
    for level in (tall * 0.3, tall * 0.72):
        cylinder(radius * 1.06, 0.06, (0, 0, level), metal, vertices=12)
    cylinder(radius * 0.35, 0.05, (radius * 0.4, 0, tall), metal, vertices=8)


def build_barrier(rng):
    """Секция ограждения: рама на ножках и вертикальные прутья."""
    metal = material('metal', hex_to_linear(METAL, jitter=0.04, rng=rng))

    width = 2.0
    tall = 1.1
    bar = 0.05
    for level in (tall - bar, tall * 0.45):
        box((width, bar, bar), (0, 0, level), metal)
    foot = 0.5
    for side in (-1, 1):
        box((bar, bar, tall), (side * (width / 2 - bar), 0, tall / 2), metal)
        box((foot, 0.16, 0.09), (side * (width - foot) / 2, 0, 0.045), metal)

    bars = 7
    for index in range(bars):
        offset = -width / 2 + width * (index + 1) / (bars + 1)
        box((bar * 0.7, bar * 0.7, tall - bar), (offset, 0, (tall - bar) / 2), metal)


PROP_BUILDERS = {
    'speaker-stack': build_speaker_stack,
    'crate': build_crate,
    'barrel': build_barrel,
    'barrier': build_barrier,
}


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def join_all(name):
    """Сшивает примитивы в один объект с началом координат в центре подошвы.

    Игра ставит модель на высоту рельефа по её origin (src/objects/registry.js),
    поэтому origin обязан лежать на нуле, иначе проп утонет или повиснет.
    """
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    prop = bpy.context.object
    prop.name = name
    return prop


def triangle_count(obj):
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)


def setup_render(prop, output):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = RENDER_SAMPLES
    scene.cycles.use_denoising = False
    scene.render.resolution_x = RENDER_SIZE
    scene.render.resolution_y = RENDER_SIZE
    scene.render.filepath = str(output)

    scene.world = bpy.data.worlds.new('W')
    scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.05, 0.07, 1)

    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(55), 0, math.radians(35))
    bpy.context.collection.objects.link(sun)

    size = max(prop.dimensions)
    target = Vector((0, 0, prop.dimensions.z / 2))
    cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    cam.location = target + Vector((size * 1.5, -size * 2.2, size * 1.0))
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (cam.location - target).to_track_quat('Z', 'Y')


def generate(prop_name, out_path, seed, render_path):
    clear_scene()
    rng = random.Random(seed)
    PROP_BUILDERS[prop_name](rng)
    prop = join_all(prop_name)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    prop.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path), export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True,
    )

    tris = triangle_count(prop)
    size = out_path.stat().st_size / 1024
    dimensions = tuple(round(value, 2) for value in prop.dimensions)
    print(f'{prop_name}: {tris} треугольников, {size:.0f} КБ, габариты {dimensions} м -> {out_path}')

    if render_path:
        render_path.parent.mkdir(parents=True, exist_ok=True)
        setup_render(prop, render_path)
        bpy.ops.render.render(write_still=True)
        print(f'{prop_name}: контрольный кадр {render_path}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--prop', choices=(*PROP_BUILDERS, 'all'), default='all')
    p.add_argument('--out', type=Path, help='путь к GLB (только для одного пропа)')
    p.add_argument('--out-dir', type=Path, default=Path('public/assets/models/props'))
    p.add_argument('--seed', type=int, default=1)
    p.add_argument('--render', type=Path, help='куда положить контрольный кадр PNG')
    args = p.parse_args(argv)

    names = list(PROP_BUILDERS) if args.prop == 'all' else [args.prop]
    if args.out and len(names) > 1:
        p.error('--out работает только с одним --prop, для всех пропов используй --out-dir')

    for name in names:
        out_path = args.out or args.out_dir / f'{name}.glb'
        render_path = args.render if len(names) == 1 else None
        generate(name, out_path, args.seed, render_path)


if __name__ == '__main__':
    main()
