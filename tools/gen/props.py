#!/usr/bin/env python3
"""Процедурные лоу-поли пропы рейв-сцены (Blender headless, без ИИ и без облака).

Пропы это не персонажи: у них нет скелета, анатомии и анимаций, поэтому весь
маршрут «картинка -> меш -> риг» им не нужен. Ящик, бочка, ферма со светом,
барная стойка и остальная утварь рейв-поля собираются из примитивов за секунды,
детерминированно по сиду и сразу в бюджете PS1-эстетики (сотни треугольников,
плоские нормали).

Рядом с GLB кладётся `manifest.json` с русскими именами пропов: больше про них
знать неоткуда, всё остальное читается из самих файлов. Единая опись проекта
(`tools/inventory`) берёт имена оттуда, а новый проп видит просто потому, что он
появился на диске.

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
import json
import math
import random
import sys
from collections import namedtuple
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
ALUMINIUM = '#7d8496'
PLASTIC = '#3f6b55'
PLASTIC_ROOF = '#8d9aa2'
PAPER = '#8d8878'
SIGN = '#c2bdad'

RENDER_SAMPLES = 12
RENDER_SIZE = 640
MANIFEST_NAME = 'manifest.json'


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


def neon(color, strength=3.0):
    """Светящийся материал акцентного цвета: единственный источник неона у пропов."""
    return material(f'neon-{color}', hex_to_linear(color), emission=strength)


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
    accent = neon(rng.choice(NEON_COLORS))

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
    ring(0.42, 0.05, (0, -0.44, top), accent, rotation=(math.pi / 2, 0, 0))


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


def build_bar_counter(rng):
    """Барная стойка: фанерная тумба, тёмная столешница, неон под козырьком."""
    plywood = material('plywood', hex_to_linear(PLYWOOD, jitter=0.04, rng=rng))
    cabinet = material('cabinet', hex_to_linear(CABINET))
    metal = material('metal', hex_to_linear(METAL))
    accent = neon(rng.choice(NEON_COLORS))

    width, depth, tall = 3.0, 0.62, 1.02
    box((width, depth, tall), (0, 0, tall / 2), plywood)
    box((width + 0.12, depth + 0.18, 0.08), (0, 0, tall + 0.04), cabinet)
    box((width - 0.1, 0.05, 0.05), (0, -depth / 2 - 0.06, tall - 0.14), accent)
    cylinder(
        0.03, width - 0.2, (0, -depth / 2 - 0.12, 0.18), metal,
        vertices=8, rotation=(0, math.pi / 2, 0),
    )
    for offset in (-1.15, -0.95, 1.05):
        cylinder(0.05, 0.3, (offset, 0.06, tall + 0.23), metal, vertices=8)


def build_truss_tower(rng):
    """Ферма из четырёх поясов с раскосами и парой прожекторов на верхней траверсе."""
    metal = material('metal', hex_to_linear(METAL))
    aluminium = material('aluminium', hex_to_linear(ALUMINIUM, jitter=0.03, rng=rng))
    accent = neon(rng.choice(NEON_COLORS), strength=4.0)

    side, tall, tube = 0.34, 3.3, 0.03
    base = 0.05
    box((side + 0.22, side + 0.22, base), (0, 0, base / 2), metal)
    for x_sign in (-1, 1):
        for y_sign in (-1, 1):
            cylinder(
                tube, tall, (x_sign * side / 2, y_sign * side / 2, base + tall / 2),
                aluminium, vertices=6,
            )

    levels = 5
    rise = tall / levels
    tilt = math.atan2(rise, side)
    for index in range(levels):
        low = base + rise * index
        for sign in (-1, 1):
            box((side, tube, tube), (0, sign * side / 2, low), aluminium)
            box((tube, side, tube), (sign * side / 2, 0, low), aluminium)
            box(
                (math.hypot(side, rise), tube, tube), (0, sign * side / 2, low + rise / 2),
                aluminium, rotation=(0, -tilt if index % 2 else tilt, 0),
            )

    top = base + tall
    box((0.86, tube * 2, tube * 2), (0, 0, top), aluminium)
    for sign in (-1, 1):
        box((0.06, 0.06, 0.14), (sign * 0.32, 0, top - 0.07), metal)
        cylinder(0.11, 0.26, (sign * 0.32, 0, top - 0.27), metal, vertices=8)
        cylinder(0.1, 0.03, (sign * 0.32, 0, top - 0.41), accent, vertices=8)


def build_stage_light(rng):
    """Прожектор на треноге: колонна, вилка и неоновая линза в сторону танцпола."""
    metal = material('metal', hex_to_linear(METAL, jitter=0.03, rng=rng))
    cabinet = material('cabinet', hex_to_linear(CABINET))
    accent = neon(rng.choice(NEON_COLORS), strength=4.0)

    column = 1.5
    cylinder(0.045, column, (0, 0, column / 2), metal, vertices=8)
    stance, hinge = 0.46, 1.0
    leg = math.hypot(stance, hinge)
    for index in range(3):
        yaw = index * math.tau / 3
        cylinder(
            0.028, leg, (math.cos(yaw) * stance / 2, math.sin(yaw) * stance / 2, hinge / 2),
            metal, vertices=6, rotation=(-math.atan2(stance, hinge), 0, yaw + math.pi / 2),
        )

    head = column + 0.18
    box((0.32, 0.3, 0.28), (0, 0, head), cabinet)
    for sign in (-1, 1):
        box((0.04, 0.05, 0.22), (sign * 0.19, 0, head), metal)
    cylinder(0.12, 0.05, (0, -0.17, head), accent, vertices=10, rotation=(math.pi / 2, 0, 0))


def build_trash_pile(rng):
    """Куча мусора: коробки, банки и картон вповалку, силуэт целиком от сида.

    Обломки кладутся под купол `peak * (1 - (r/heap)^2)`: у центра высоко, к краю
    сходит на нет. Так они перекрываются и читаются кучей, а не россыпью висящих
    в воздухе кубиков.
    """
    palette = (PAPER, PLYWOOD, RUST, DRUM, METAL)
    litter = {
        color: material(f'litter-{color}', hex_to_linear(color, jitter=0.05, rng=rng))
        for color in palette
    }

    heap, peak = 0.62, 0.46
    box((1.05, 0.9, 0.05), (0, 0, 0.025), litter[PAPER], rotation=(0, 0, 0.4))
    for _ in range(18):
        yaw = rng.uniform(0, math.tau)
        radius = rng.uniform(0, heap)
        spot = (math.cos(yaw) * radius, math.sin(yaw) * radius)
        dome = peak * (1 - (radius / heap) ** 2)
        level = rng.uniform(0.06, 0.06 + dome)
        tumble = (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, math.tau))
        mat = litter[rng.choice(palette)]
        if rng.random() < 0.65:
            size = (rng.uniform(0.14, 0.32), rng.uniform(0.14, 0.3), rng.uniform(0.1, 0.24))
            box(size, (*spot, level), mat, rotation=tumble)
        else:
            cylinder(
                rng.uniform(0.05, 0.09), rng.uniform(0.12, 0.24), (*spot, level),
                mat, vertices=8, rotation=tumble,
            )


def build_road_sign(rng):
    """Указатель: две стрелки в разные стороны на столбе, кромка подсвечена."""
    metal = material('metal', hex_to_linear(METAL))
    plate = material('sign', hex_to_linear(SIGN, jitter=0.03, rng=rng))
    accent = neon(rng.choice(NEON_COLORS), strength=2.5)

    pole = 2.35
    cylinder(0.045, pole, (0, 0, pole / 2), metal, vertices=8)
    cylinder(0.17, 0.06, (0, 0, 0.03), metal, vertices=8)
    for level, direction, width in ((2.05, 1, 0.95), (1.62, -1, 0.8)):
        centre = direction * (width / 2 + 0.04)
        box((width, 0.05, 0.24), (centre, 0, level), plate)
        cylinder(
            0.17, 0.05, (direction * (width + 0.04), 0, level), plate, vertices=3,
            rotation=(math.pi / 2, 0, 0 if direction > 0 else math.pi),
        )
        box((width * 0.8, 0.02, 0.04), (centre, -0.035, level - 0.08), accent)


def build_pallet(rng):
    """Европоддон: три лаги на девяти шашках и настил в пять досок."""
    plywood = material('plywood', hex_to_linear(PLYWOOD, jitter=0.05, rng=rng))

    length, width = 1.2, 0.8
    board, blockish = 0.022, 0.078
    for across in (-width / 2 + 0.05, 0, width / 2 - 0.05):
        box((length, 0.1, board), (0, across, board / 2), plywood)
        for along in (-length / 2 + 0.05, 0, length / 2 - 0.05):
            box((0.1, 0.1, blockish), (along, across, board + blockish / 2), plywood)
    deck = board + blockish + board / 2
    for index in range(5):
        along = -length / 2 + 0.05 + index * (length - 0.1) / 4
        box((0.1, width, board), (along, 0, deck), plywood)


def build_trash_bin(rng):
    """Уличная урна с ободом и наклейкой промоутера."""
    metal = material('metal', hex_to_linear(METAL, jitter=0.04, rng=rng))
    body_color = DRUM if rng.random() < 0.5 else RUST
    body = material(f'bin-{body_color}', hex_to_linear(body_color, jitter=0.04, rng=rng))
    accent = neon(rng.choice(NEON_COLORS), strength=2.0)

    radius, tall = 0.27, 0.82
    cylinder(radius, tall, (0, 0, tall / 2), body, vertices=10)
    cylinder(radius * 1.08, 0.06, (0, 0, tall - 0.03), metal, vertices=10)
    cylinder(radius * 0.94, 0.05, (0, 0, 0.025), metal, vertices=10)
    box((0.2, 0.02, 0.12), (0, -radius, tall * 0.62), accent)


def build_graffiti_board(rng):
    """Фанерный щит на подкосах, расписанный неоновыми росчерками."""
    plywood = material('plywood', hex_to_linear(PLYWOOD, jitter=0.05, rng=rng))
    metal = material('metal', hex_to_linear(METAL))

    width, tall, thickness = 2.4, 1.9, 0.07
    box((width, thickness, tall), (0, 0, tall / 2), plywood)

    brace_top, brace_tilt = 1.3, 0.6
    brace = brace_top / math.cos(brace_tilt)
    reach = brace * math.sin(brace_tilt)
    for sign in (-1, 1):
        post = sign * (width / 2 - 0.1)
        box((0.09, 0.09, tall), (post, thickness, tall / 2), metal)
        box(
            (0.07, 0.07, brace), (post, thickness + reach / 2, brace_top / 2), metal,
            rotation=(-brace_tilt, 0, 0),
        )
        box((0.16, 0.4, 0.06), (post, thickness + reach, 0.03), metal)

    for _ in range(4):
        box(
            (rng.uniform(0.4, 1.1), 0.02, rng.uniform(0.05, 0.12)),
            (rng.uniform(-0.7, 0.7), -thickness / 2, rng.uniform(0.35, tall - 0.3)),
            neon(rng.choice(NEON_COLORS), strength=2.5),
            rotation=(0, rng.uniform(-0.7, 0.7), 0),
        )


def build_cable_spool(rng):
    """Катушка от кабеля: на рейве это стол, поэтому щёки крупные, а кабель размотан."""
    plywood = material('plywood', hex_to_linear(PLYWOOD, jitter=0.05, rng=rng))
    coil = material('coil', hex_to_linear(CABINET))

    radius, cheek, gap = 0.62, 0.07, 0.62
    cylinder(radius, cheek, (0, 0, cheek / 2), plywood, vertices=12)
    cylinder(radius, cheek, (0, 0, cheek * 1.5 + gap), plywood, vertices=12)
    cylinder(0.2, gap, (0, 0, cheek + gap / 2), plywood, vertices=10)
    cylinder(0.44, gap * 0.82, (0, 0, cheek + gap / 2), coil, vertices=12)


def build_porta_toilet(rng):
    """Биотуалет: обязательный житель поля, на которое приехал рейв."""
    shell = material('plastic', hex_to_linear(PLASTIC, jitter=0.04, rng=rng))
    door_shell = material('plastic-door', hex_to_linear(PLASTIC, jitter=0.07, rng=rng))
    roof = material('plastic-roof', hex_to_linear(PLASTIC_ROOF, jitter=0.03, rng=rng))
    metal = material('metal', hex_to_linear(METAL))

    width, depth, tall = 1.12, 1.12, 2.16
    skid = 0.08
    box((width, depth, skid), (0, 0, skid / 2), metal)
    box((width, depth, tall), (0, 0, skid + tall / 2), shell)
    box((width + 0.1, depth + 0.1, 0.1), (0, 0, skid + tall + 0.05), roof)

    door, door_tall = 0.74, 1.9
    front = -depth / 2 - 0.03
    box((door, 0.06, door_tall), (0, front, skid + door_tall / 2), door_shell)
    box((0.06, 0.05, 0.16), (door / 2 - 0.08, front - 0.04, skid + 1.05), metal)
    for index in range(3):
        box((door * 0.7, 0.03, 0.04), (0, front - 0.03, skid + 1.62 + index * 0.09), metal)


Prop = namedtuple('Prop', ('title', 'build'))

PROPS = {
    'speaker-stack': Prop('Стек колонок', build_speaker_stack),
    'crate': Prop('Ящик', build_crate),
    'barrel': Prop('Бочка', build_barrel),
    'barrier': Prop('Ограждение', build_barrier),
    'bar-counter': Prop('Барная стойка', build_bar_counter),
    'truss-tower': Prop('Ферма со светом', build_truss_tower),
    'stage-light': Prop('Прожектор на стойке', build_stage_light),
    'trash-pile': Prop('Куча мусора', build_trash_pile),
    'road-sign': Prop('Указатель', build_road_sign),
    'pallet': Prop('Поддон', build_pallet),
    'trash-bin': Prop('Урна', build_trash_bin),
    'graffiti-board': Prop('Граффити-щит', build_graffiti_board),
    'cable-spool': Prop('Катушка кабеля', build_cable_spool),
    'porta-toilet': Prop('Биотуалет', build_porta_toilet),
}


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def join_all(name):
    """Сшивает примитивы в один объект с началом координат в центре подошвы.

    Игра ставит модель на высоту рельефа по её origin (src/objects/registry.js),
    поэтому origin обязан лежать на нуле, иначе проп утонет или повиснет. Осадка
    на ноль сделана явно: у пропов со случайными наклонами (куча мусора) нижняя
    точка заранее неизвестна.
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
    prop.location.z = -min(vertex.co.z for vertex in prop.data.vertices)
    bpy.ops.object.transform_apply(location=True)
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


def write_manifest(path):
    """Русские имена пропов: единственное, чего по самому GLB не узнать.

    Полигонаж, габариты и вес отсюда убраны намеренно: их меряет по файлам
    единая опись проекта (`tools/inventory`), и вторая копия цифр рядом с
    моделями только расходилась бы с ними. По той же причине здесь нет чужих
    записей: раньше эта опись притворялась описью всей библиотеки и на каждом
    прогоне выкидывала из неё всё, что сделал не этот скрипт.
    """
    props = [
        {'name': name, 'title': prop.title, 'file': f'{name}.glb'}
        for name, prop in PROPS.items() if (path.parent / f'{name}.glb').exists()
    ]
    path.write_text(
        json.dumps({'tool': 'tools/gen/props.py', 'props': props}, ensure_ascii=False, indent=2) + '\n',
        encoding='utf-8',
    )


def generate(prop_name, out_path, seed, render_path):
    clear_scene()
    rng = random.Random(seed)
    PROPS[prop_name].build(rng)
    prop = join_all(prop_name)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    prop.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=str(out_path), export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True,
    )

    tris = triangle_count(prop)
    kilobytes = round(out_path.stat().st_size / 1024)
    width, depth, height = (round(value, 2) for value in prop.dimensions)
    print(f'{prop_name}: {tris} треугольников, {kilobytes} КБ, '
          f'габариты {width} x {height} x {depth} м -> {out_path}')

    if render_path:
        render_path.parent.mkdir(parents=True, exist_ok=True)
        setup_render(prop, render_path)
        bpy.ops.render.render(write_still=True)
        print(f'{prop_name}: контрольный кадр {render_path}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--prop', choices=(*PROPS, 'all'), default='all')
    p.add_argument('--out', type=Path, help='путь к GLB (только для одного пропа)')
    p.add_argument('--out-dir', type=Path, default=Path('public/assets/models/props'))
    p.add_argument('--seed', type=int, default=1)
    p.add_argument('--render', type=Path, help='куда положить контрольный кадр PNG')
    args = p.parse_args(argv)

    names = list(PROPS) if args.prop == 'all' else [args.prop]
    if args.out and len(names) > 1:
        p.error('--out работает только с одним --prop, для всех пропов используй --out-dir')

    for name in names:
        out_path = args.out or args.out_dir / f'{name}.glb'
        render_path = args.render if len(names) == 1 else None
        generate(name, out_path, args.seed, render_path)

    manifest = (args.out.parent if args.out else args.out_dir) / MANIFEST_NAME
    write_manifest(manifest)
    print(f'опись библиотеки: {manifest} ({len(json.loads(manifest.read_text())["props"])} пропов)')


if __name__ == '__main__':
    main()
