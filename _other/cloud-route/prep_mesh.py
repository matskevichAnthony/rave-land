"""Готовит сырой меш из облака к ригу: бюджет полигонов плюс текстура из концепта.

Hunyuan отдал только форму (текстурная ветка Space недоступна анонимной очереди),
поэтому цвет берём проекцией исходной картинки: передние полигоны читают концепт,
задние - его зеркало с залитым затылком, чтобы лицо не отпечаталось сзади.
Для PS1-эстетики этого хватает, детализация и так живёт в текстуре.

Запуск: blender -b --python prep_mesh.py -- <вход.glb> <концепт.png> <выход.glb> <треугольников>
"""
import math
import sys
from pathlib import Path

import bpy
import numpy as np

WORK = Path(__file__).resolve().parent
sys.path.insert(0, str(WORK))
sys.path.insert(0, str(WORK.parent / 'auto-rig'))
import rig_lib
from route import FRONT_AXIS_SIGN

BACKGROUND_TOLERANCE = 0.08
INPAINT_STEPS = 24
ERODE_STEPS = 3
SCALP_BAND = 0.03
SIDE_COLUMN_WIDTH = 8
SIDE_SMOOTH = 0.08
SIDE_MARGIN = 1.25
HEAD_COLUMN_MARGIN = 0.015
HEAD_START = 0.86
HEAD_DECIMATE_SHARE = 0.25
SMOOTH_ANGLE = math.radians(38)


def neighbours(array):
    return [np.roll(array, shift, axis) for axis, shift in ((0, 1), (0, -1), (1, 1), (1, -1))]


def erode(mask, steps):
    """Съедает кайму силуэта: по краю картинки лежит светлый ореол сглаживания,
    спроецированный на бортовые полигоны он читается как обводка."""
    for _ in range(steps):
        mask = np.logical_and.reduce([mask] + neighbours(mask))
    return mask


def load_pixels(path):
    image = bpy.data.images.load(str(path))
    pixels = np.array(image.pixels[:], dtype=np.float32).reshape(image.size[1], image.size[0], 4)
    bpy.data.images.remove(image)
    return pixels


def crop_to_subject(pixels):
    """Обрезает фон по краям: меш восстановлен по силуэту, UV кладём на него же."""
    background = pixels[0, 0, :3]
    subject = np.abs(pixels[:, :, :3] - background).max(axis=2) > BACKGROUND_TOLERANCE
    rows, cols = np.flatnonzero(subject.any(axis=1)), np.flatnonzero(subject.any(axis=0))
    box = (slice(rows[0], rows[-1] + 1), slice(cols[0], cols[-1] + 1))
    return pixels[box].copy(), erode(subject[box], ERODE_STEPS)


def inpaint_background(pixels, subject):
    """Растягивает цвет силуэта на фон, иначе по краям модели течёт серый студийный фон."""
    filled = pixels.copy()
    mask = subject.astype(np.float32)[:, :, None]
    filled *= mask
    for _ in range(INPAINT_STEPS):
        around = sum(neighbours(filled))
        weights = sum(neighbours(mask))
        grown = np.divide(around, weights, out=np.zeros_like(around), where=weights > 0)
        empty = mask == 0
        filled = np.where(empty, grown, filled)
        mask = np.where(empty & (weights > 0), 1.0, mask)
    filled[:, :, 3] = 1.0
    return filled


def make_back(pixels, subject):
    """Зеркало концепта, где лицо заменено цветом макушки: затылок, а не второе лицо.

    Заливка держится в колонках самой головы: если брать всю ширину силуэта, на
    капюшон и плечи ложится светлое пятно и сзади читается как поля шляпы.
    """
    back = np.fliplr(pixels).copy()
    mask = np.fliplr(subject)
    height, width = mask.shape
    crown = mask[int(height * (1 - SCALP_BAND)):]
    scalp = back[int(height * (1 - SCALP_BAND)):][crown]
    columns = np.flatnonzero(crown.any(axis=0))
    margin = int(width * HEAD_COLUMN_MARGIN)
    head = np.zeros_like(mask)
    head[int(height * HEAD_START):,
         max(columns[0] - margin, 0):columns[-1] + margin] = True
    back[head & mask] = scalp.mean(axis=0)
    return back


def save_image(name, pixels):
    image = bpy.data.images.new(name, pixels.shape[1], pixels.shape[0], alpha=False)
    image.pixels = pixels.ravel().tolist()
    image.filepath_raw = str(WORK / f'{name}.png')
    image.file_format = 'PNG'
    image.save()
    return image


def make_material(name, image):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    shader = tree.nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = 0.9
    shader.inputs['Metallic'].default_value = 0.0
    texture = tree.nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Linear'
    tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    return material


def count_tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def head_vertex_group(obj):
    """Группа-щит для головы: равномерная децимация съедает лицо раньше всего,
    потому что оно занимает малую долю площади, а деталей требует больше всех."""
    coords = rig_lib.get_verts(obj)
    height = coords[:, 2].max()
    group = obj.vertex_groups.new(name='decimate_shield')
    for index, co in enumerate(coords):
        above = (co[2] - HEAD_START * height) / ((1 - HEAD_START) * height)
        shield = min(max(above, 0.0), 1.0)
        group.add([index], 1.0 - shield * (1.0 - HEAD_DECIMATE_SHARE), 'REPLACE')
    return group


def apply_decimate(obj, ratio, vertex_group=None):
    modifier = obj.modifiers.new('Decimate', 'DECIMATE')
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    if vertex_group:
        modifier.vertex_group = vertex_group.name
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def decimate(obj, target_tris):
    tris = count_tris(obj)
    if tris <= target_tris:
        print(f'DECIMATE skipped: {tris} tris already within budget')
        return
    apply_decimate(obj, target_tris / tris, head_vertex_group(obj))
    shielded = count_tris(obj)
    if shielded > target_tris:
        apply_decimate(obj, target_tris / shielded)
    print(f'DECIMATED {tris} -> {shielded} -> {count_tris(obj)} tris')


def smooth_shading(obj):
    """Сглаженные нормали на плавных участках: гранёный череп читается как мутант,
    а рёбра одежды остаются жёсткими и держат low-poly вид."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle(angle=SMOOTH_ANGLE)


def project_uv(obj):
    """UV фронтальной проекцией: X силуэта в U, Z в V, ровно как снималась картинка."""
    mesh = obj.data
    coords = rig_lib.get_verts(obj)
    low, high = coords.min(axis=0), coords.max(axis=0)
    uv_layer = mesh.uv_layers.new(name='Projected')
    for loop in mesh.loops:
        co = coords[loop.vertex_index]
        uv_layer.data[loop.index].uv = ((co[0] - low[0]) / (high[0] - low[0]),
                                        (co[2] - low[2]) / (high[2] - low[2]))


def side_column(pixels, subject):
    """Ровный тон по высоте для бортовых полигонов: фронтальная проекция на них
    растягивает пиксели в полосы. Медиана строки берётся с сильным вертикальным
    сглаживанием, иначе брови, уши и рот дают на черепе поперечные ленты."""
    height = pixels.shape[0]
    medians = np.zeros((height, 4), dtype=np.float32)
    for row in range(height):
        visible = pixels[row][subject[row]]
        if len(visible):
            medians[row] = np.median(visible, axis=0)
    window = max(int(height * SIDE_SMOOTH), 1)
    kernel = np.ones(window) / window
    padded = np.pad(medians, ((window, window), (0, 0)), mode='edge')
    smoothed = np.stack([np.convolve(padded[:, channel], kernel, mode='same')[window:window + height]
                         for channel in range(4)], axis=1)
    smoothed[:, 3] = 1.0
    return np.repeat(smoothed[:, None, :], SIDE_COLUMN_WIDTH, axis=1)


def assign_sides(obj, materials):
    """Полигон читает концепт только пока смотрит вперёд или назад: у бортовых
    граней фронтальная проекция растягивает пиксели в полосы."""
    mesh = obj.data
    mesh.materials.clear()
    for material in materials:
        mesh.materials.append(material)
    counts = [0, 0, 0]
    for polygon in mesh.polygons:
        normal = polygon.normal
        facing = normal.y * FRONT_AXIS_SIGN
        sideways = max(abs(normal.x), abs(normal.z))
        index = 2 if abs(normal.y) * SIDE_MARGIN < sideways else 0 if facing > 0 else 1
        polygon.material_index = index
        counts[index] += 1
    print(f'SIDES front {counts[0]}, back {counts[1]}, side {counts[2]}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    source, concept, output, target_tris = argv[0], argv[1], argv[2], int(argv[3])

    obj = rig_lib.import_and_normalize(source)
    decimate(obj, target_tris)
    smooth_shading(obj)
    project_uv(obj)

    cropped, subject = crop_to_subject(load_pixels(concept))
    front_pixels = inpaint_background(cropped, subject)
    images = (save_image('texture-front', front_pixels),
              save_image('texture-back', make_back(front_pixels, subject)),
              save_image('texture-side', side_column(front_pixels, subject)))
    assign_sides(obj, [make_material(f'raver_{name}', image) for name, image
                       in zip(('front', 'back', 'side'), images)])

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True)
    print('EXPORTED', output)


main()
