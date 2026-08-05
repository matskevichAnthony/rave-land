"""Готовит сырой меш из облака к ригу: бюджет полигонов плюс текстура из концепта.

Hunyuan отдал только форму (текстурная ветка Space недоступна анонимной очереди),
поэтому цвет берём проекцией исходной картинки: передние полигоны читают концепт,
задние - его зеркало с залитым затылком, чтобы лицо не отпечаталось сзади.
Для PS1-эстетики этого хватает, детализация и так живёт в текстуре.

Запуск: blender -b --python prep_mesh.py -- <вход.glb> <концепт.png> <выход.glb> <треугольников>
"""
import sys
from pathlib import Path

import bpy
import numpy as np

WORK = Path(__file__).resolve().parent
sys.path.insert(0, str(WORK.parent / 'auto-rig'))
import rig_lib

BACKGROUND_TOLERANCE = 0.08
INPAINT_STEPS = 24
ERODE_STEPS = 3
HEAD_BAND = 0.11
SCALP_BAND = 0.03
FRONT_AXIS_SIGN = -1.0


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
    """Зеркало концепта, где лицо заменено цветом макушки: затылок, а не второе лицо."""
    back = np.fliplr(pixels).copy()
    mask = np.fliplr(subject)
    height = back.shape[0]
    scalp = back[int(height * (1 - SCALP_BAND)):][mask[int(height * (1 - SCALP_BAND)):]]
    head = np.zeros_like(mask)
    head[int(height * (1 - HEAD_BAND)):] = mask[int(height * (1 - HEAD_BAND)):]
    back[head] = scalp.mean(axis=0)
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
    texture.interpolation = 'Closest'
    tree.links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    return material


def decimate(obj, target_tris):
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris <= target_tris:
        print(f'DECIMATE skipped: {tris} tris already within budget')
        return
    modifier = obj.modifiers.new('Decimate', 'DECIMATE')
    modifier.ratio = target_tris / tris
    modifier.use_collapse_triangulate = True
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    print(f'DECIMATED {tris} -> {sum(len(p.vertices) - 2 for p in obj.data.polygons)} tris')


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


def assign_sides(obj, front_material, back_material):
    mesh = obj.data
    mesh.materials.clear()
    mesh.materials.append(front_material)
    mesh.materials.append(back_material)
    back = 0
    for polygon in mesh.polygons:
        facing_front = polygon.normal.y * FRONT_AXIS_SIGN > 0
        polygon.material_index = 0 if facing_front else 1
        back += not facing_front
    print(f'SIDES front {len(mesh.polygons) - back}, back {back}')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    source, concept, output, target_tris = argv[0], argv[1], argv[2], int(argv[3])

    obj = rig_lib.import_and_normalize(source)
    decimate(obj, target_tris)
    project_uv(obj)

    cropped, subject = crop_to_subject(load_pixels(concept))
    front_pixels = inpaint_background(cropped, subject)
    front = save_image('texture-front', front_pixels)
    back = save_image('texture-back', make_back(front_pixels, subject))
    assign_sides(obj, make_material('raver_front', front), make_material('raver_back', back))

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=output, export_format='GLB', use_selection=True,
                              export_apply=True, export_yup=True)
    print('EXPORTED', output)


main()
