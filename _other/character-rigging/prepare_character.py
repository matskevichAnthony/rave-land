"""Prepares a TRELLIS-generated GLB character for Mixamo auto-rigging.

Run: blender --background --python prepare_character.py

Pipeline: import GLB, drop non-mesh helpers, apply transforms, scale to
human height, convert textures to PNG, analyze geometry, save .blend,
export FBX (embedded textures) and clean GLB, render preview images.
"""

import json
import math
import os

import bpy
from mathutils import Vector

INPUT_GLB = '/home/anton-matzkaim/rave-land/_other/sample_2026-07-29T160343.702.glb'
WORKDIR = '/home/anton-matzkaim/rave-land/_other/character-rigging'
TARGET_HEIGHT_M = 1.75
RENDER_SAMPLES = 32
RENDER_SIZE = (900, 1200)


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb():
    bpy.ops.import_scene.gltf(filepath=INPUT_GLB)


def mesh_objects():
    return [ob for ob in bpy.context.scene.objects if ob.type == 'MESH']


def remove_helpers():
    removed = []
    for ob in mesh_objects():
        if ob.parent:
            matrix = ob.matrix_world.copy()
            ob.parent = None
            ob.matrix_world = matrix
    for ob in list(bpy.context.scene.objects):
        if ob.type in {'CAMERA', 'LIGHT', 'EMPTY'}:
            removed.append(f'{ob.type}:{ob.name}')
            bpy.data.objects.remove(ob, do_unlink=True)
    return removed


def world_bounds():
    points = []
    for ob in mesh_objects():
        points.extend(ob.matrix_world @ Vector(corner) for corner in ob.bound_box)
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return lo, hi


def apply_all_transforms():
    bpy.ops.object.select_all(action='DESELECT')
    for ob in mesh_objects():
        ob.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objects()[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def normalize_to_human_height():
    lo, hi = world_bounds()
    height = hi.z - lo.z
    factor = TARGET_HEIGHT_M / height
    for ob in mesh_objects():
        ob.scale = (factor, factor, factor)
    apply_all_transforms()
    lo, hi = world_bounds()
    offset = Vector((-(lo.x + hi.x) / 2, -(lo.y + hi.y) / 2, -lo.z))
    for ob in mesh_objects():
        ob.location += offset
    apply_all_transforms()
    return factor


def convert_images_to_png():
    texdir = os.path.join(WORKDIR, 'textures')
    os.makedirs(texdir, exist_ok=True)
    for index, img in enumerate(bpy.data.images):
        if img.type != 'IMAGE' or img.size[0] == 0:
            continue
        path = os.path.join(texdir, f'texture_{index}.png')
        img.file_format = 'PNG'
        img.filepath_raw = path
        img.save()
        if img.packed_file:
            img.unpack(method='REMOVE')
        img.filepath = path
        img.reload()
        img.pack()


def count_components(mesh):
    parent = list(range(len(mesh.vertices)))

    def find(i):
        root = i
        while parent[root] != root:
            root = parent[root]
        while parent[i] != root:
            parent[i], i = root, parent[i]
        return root

    for edge in mesh.edges:
        a, b = edge.vertices
        parent[find(a)] = find(b)
    return len({find(i) for i in range(len(parent))})


def analyze():
    import bmesh
    stats = {'meshes': [], 'transforms_applied': True}
    for ob in mesh_objects():
        mesh = ob.data
        bm = bmesh.new()
        bm.from_mesh(mesh)
        non_manifold = sum(1 for e in bm.edges if not e.is_manifold)
        boundary = sum(1 for e in bm.edges if e.is_boundary)
        bm.free()
        stats['meshes'].append({
            'name': ob.name,
            'vertices': len(mesh.vertices),
            'triangles': sum(len(p.vertices) - 2 for p in mesh.polygons),
            'non_manifold_edges': non_manifold,
            'boundary_edges': boundary,
            'components': count_components(mesh),
            'rotation': list(ob.rotation_euler),
            'scale': list(ob.scale),
        })
    lo, hi = world_bounds()
    stats['bbox_min_m'] = [round(v, 4) for v in lo]
    stats['bbox_max_m'] = [round(v, 4) for v in hi]
    stats['dimensions_m'] = [round(hi[i] - lo[i], 4) for i in range(3)]
    return stats


def save_blend():
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(WORKDIR, 'prepared.blend'))


def export_fbx():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.fbx(
        filepath=os.path.join(WORKDIR, 'mixamo-ready.fbx'),
        use_selection=False,
        object_types={'MESH'},
        use_mesh_modifiers=True,
        mesh_smooth_type='OFF',
        path_mode='COPY',
        embed_textures=True,
        bake_space_transform=True,
        axis_forward='-Z',
        axis_up='Y',
    )


def export_glb():
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(WORKDIR, 'cleaned-static.glb'),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
    )


def add_camera(name, location, target):
    camera_data = bpy.data.cameras.new(name)
    camera = bpy.data.objects.new(name, camera_data)
    bpy.context.scene.collection.objects.link(camera)
    direction = target - Vector(location)
    camera.location = location
    camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return camera


def setup_lighting():
    world = bpy.data.worlds.new('PreviewWorld')
    world.use_nodes = True
    background = world.node_tree.nodes['Background']
    background.inputs['Color'].default_value = (0.85, 0.85, 0.87, 1.0)
    background.inputs['Strength'].default_value = 1.0
    bpy.context.scene.world = world
    sun_data = bpy.data.lights.new('Sun', type='SUN')
    sun_data.energy = 3.0
    sun = bpy.data.objects.new('Sun', sun_data)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    bpy.context.scene.collection.objects.link(sun)


def render_previews():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = RENDER_SAMPLES
    scene.render.resolution_x, scene.render.resolution_y = RENDER_SIZE
    scene.render.image_settings.file_format = 'PNG'
    setup_lighting()
    lo, hi = world_bounds()
    target = Vector((0, 0, (lo.z + hi.z) / 2))
    height = hi.z - lo.z
    distance = height * 1.9
    views = {
        'front': (0, -distance, target.z),
        'side': (distance, 0, target.z),
        'perspective': (distance * 0.75, -distance * 0.75, target.z + height * 0.35),
    }
    for name, location in views.items():
        camera = add_camera(f'cam_{name}', location, target)
        scene.camera = camera
        scene.render.filepath = os.path.join(WORKDIR, f'{name}.png')
        bpy.ops.render.render(write_still=True)


def main():
    clean_scene()
    import_glb()
    removed = remove_helpers()
    apply_all_transforms()
    scale_factor = normalize_to_human_height()
    convert_images_to_png()
    stats = analyze()
    stats['removed_helpers'] = removed
    stats['scale_factor_applied'] = round(scale_factor, 4)
    save_blend()
    export_fbx()
    export_glb()
    render_previews()
    with open(os.path.join(WORKDIR, 'stats.json'), 'w') as fh:
        json.dump(stats, fh, indent=2)
    print('STATS:', json.dumps(stats))


main()
