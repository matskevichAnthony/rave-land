"""Parsed RenderWare clump -> Blender armature, skinned mesh and GLB export.

Runs inside Blender headless; dff2glb.py drives it and does the texture work
and post-processing that need the system Python.

Two coordinate hops happen here. The model is Y-up with +Z forward, so the
whole rig is turned a quarter turn about X to reach Blender's Z-up and the -Y
facing the project's characters use. And the mesh is stored in skin space,
which the inverse bind matrices map back to model space: that map is one rigid
transform shared by every bone, so it is read off the first bone and checked
against the others rather than blended per vertex.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.append(str(Path(__file__).resolve().parent.parent))

from gta.dff import load_dff
from gta.ifp import load_ifp

MODEL_TO_BLENDER = Matrix.Rotation(math.radians(90), 4, 'X')
# Blender points a bone along its local Y, RenderWare frames along their X.
BONE_TO_FRAME = Matrix.Rotation(math.radians(-90), 4, 'Z')
# Every .ifp track but one drops straight onto its frame. The root does not:
# the animations are authored Z-up and +Y forward, the model is Y-up and +Z
# forward, and applying the root rotation raw lays the character on his back.
IFP_TO_MODEL = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0))).to_4x4()
ROOT_BONE = 0

LEAF_BONE_LENGTH = 0.05
SKIN_SPACE_TOLERANCE = 1e-4
OPAQUE = 1.0
RGBA_BIT_DEPTH = 32
CLIP_FPS = 30
SWAY_WINDOW_SECONDS = 1.0
HORIZONTAL_AXES = (0, 2)


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--dff', type=Path, required=True)
    parser.add_argument('--glb', type=Path, required=True)
    parser.add_argument('--textures', type=Path,
                        help='JSON map of texture name to PNG file, unpacked from the .txd')
    parser.add_argument('--ifp', type=Path, help='animation package, e.g. ped.ifp')
    parser.add_argument('--clips', default='', help='comma separated animation names')
    parser.add_argument('--prop', action='store_true',
                        help='keep the authored origin: weapons are built in the hand bone '
                             'space, so lifting them onto the ground breaks the grip')
    arguments = parser.parse_args(argv)
    if arguments.clips and not arguments.ifp:
        parser.error('--clips needs an --ifp to take the animations from')
    return arguments


def local_matrix(frame):
    """A frame's transform relative to its parent.

    RenderWare keeps the rotation with its rows holding the basis vectors,
    which is the transpose of the column-vector convention used here.
    """
    rows = frame.rotation
    return Matrix(((rows[0], rows[3], rows[6], frame.position[0]),
                   (rows[1], rows[4], rows[7], frame.position[1]),
                   (rows[2], rows[5], rows[8], frame.position[2]),
                   (0.0, 0.0, 0.0, 1.0)))


def frame_matrices(clump):
    """Every frame's transform in model space, parents applied."""
    world = []
    for frame in clump.frames:
        local = local_matrix(frame)
        world.append(world[frame.parent] @ local if frame.parent >= 0 else local)
    return world


def skin_to_model(clump, skin, world):
    """The rigid transform taking stored vertex positions to model space."""
    frame_of_bone = {frame.bone_id: index for index, frame in enumerate(clump.frames)}
    transforms = [world[frame_of_bone[bone_id]] @ Matrix(skin.inverse_bind_matrices[index])
                  for index, bone_id in enumerate(clump.bone_order)]
    spread = max(max(abs(value) for row in transform - transforms[0] for value in row)
                 for transform in transforms)
    if spread > SKIN_SPACE_TOLERANCE:
        raise SystemExit(f'{clump} skin space is not one rigid transform, spread {spread:.5f}')
    return transforms[0]


def atomic_placements(clump, world):
    """Blender-space transform for each atomic's vertices."""
    placements = []
    for atomic in clump.atomics:
        skin = clump.geometries[atomic.geometry].skin
        placements.append(MODEL_TO_BLENDER @ (skin_to_model(clump, skin, world) if skin
                                              else world[atomic.frame]))
    return placements


def stand_on_ground(clump, placements):
    """Lift the model onto z=0; RenderWare peds are built around the hip."""
    lowest = min((placement @ Vector(vertex)).z
                 for atomic, placement in zip(clump.atomics, placements)
                 for vertex in clump.geometries[atomic.geometry].vertices)
    return Matrix.Translation((0.0, 0.0, -lowest))


def build_armature(clump, world, placement):
    armature = bpy.data.armatures.new('Skeleton')
    rig = bpy.data.objects.new('Rig', armature)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')

    lengths = {}
    for frame in clump.frames:
        if frame.bone_id >= 0 and frame.parent >= 0:
            lengths.setdefault(frame.parent, Vector(frame.position).length)
    bones = {}
    for index, frame in enumerate(clump.frames):
        if frame.bone_id < 0:
            continue
        bone = armature.edit_bones.new(frame.name)
        bone.tail = (0.0, lengths.get(index) or LEAF_BONE_LENGTH, 0.0)
        bone.matrix = placement @ world[index] @ BONE_TO_FRAME
        bone.parent = bones.get(frame.parent)
        bones[index] = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def part_name(clump, atomic, geometry):
    """Node name for one atomic: its frame name on props, a plain label on peds.

    A weapon carries its meaning in the frame names: the engine finds the muzzle
    flash, the minigun barrel and the jetpack thrusters by looking up "gunflash",
    "minigun2" and "jetball1", and hides the flash until the shot. Losing those
    names is what makes an imported gun render permanently firing. A skinned ped
    is the opposite case: its one atomic hangs off "Pelvis" while the mesh is the
    whole body, so the frame name would only mislead.
    """
    if geometry.skin:
        return 'Model'
    return clump.frames[atomic.frame].name or f'part{atomic.frame}'


def build_materials(materials, textures):
    built = []
    for index, source in enumerate(materials):
        material = bpy.data.materials.new(source.texture or f'material{index}')
        material.use_nodes = True
        shader = material.node_tree.nodes['Principled BSDF']
        shader.inputs['Base Color'].default_value = source.color
        shader.inputs['Roughness'].default_value = 1.0 - source.specular
        image_path = textures.get((source.texture or '').lower())
        if image_path:
            image = material.node_tree.nodes.new('ShaderNodeTexImage')
            image.image = bpy.data.images.load(image_path)
            links = material.node_tree.links
            links.new(image.outputs['Color'], shader.inputs['Base Color'])
            if source.color[3] < OPAQUE or image.image.depth == RGBA_BIT_DEPTH:
                links.new(image.outputs['Alpha'], shader.inputs['Alpha'])
                # Hair, glasses and fences are cut-outs rather than glass, so
                # they clip instead of blending: alpha blending would need the
                # per-triangle sorting no real-time renderer does.
                material.blend_method = 'CLIP'
        built.append(material)
    return built


def build_mesh(geometry, placement, materials, name):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([placement @ Vector(vertex) for vertex in geometry.vertices], [],
                     [(a, b, c) for a, b, c, _material in geometry.triangles])
    for material in materials:
        mesh.materials.append(material)
    for polygon, triangle in zip(mesh.polygons, geometry.triangles):
        polygon.material_index = triangle[3]
    if geometry.uvs:
        uvs = mesh.uv_layers.new()
        for loop, datum in zip(mesh.loops, uvs.data):
            horizontal, vertical = geometry.uvs[loop.vertex_index]
            datum.uv = (horizontal, 1.0 - vertical)
    mesh.validate()
    mesh.shade_smooth()
    if geometry.normals:
        rotation = placement.to_3x3()
        mesh.normals_split_custom_set_from_vertices(
            [rotation @ Vector(normal) for normal in geometry.normals])

    model = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(model)
    return model


def bind_skin(model, rig, clump, skin):
    name_of_bone = {frame.bone_id: frame.name for frame in clump.frames}
    groups = [model.vertex_groups.new(name=name_of_bone[bone_id])
              for bone_id in clump.bone_order]
    for vertex, (bones, weights) in enumerate(zip(skin.bone_indices, skin.bone_weights)):
        for bone, weight in zip(bones, weights):
            if weight:
                groups[bone].add([vertex], weight, 'REPLACE')
    model.parent = rig
    model.modifiers.new('Armature', 'ARMATURE').object = rig


def moving_average(values, window):
    if window < 2:
        return list(values)
    pad = window // 2
    padded = values[pad:0:-1] + values + values[-2:-2 - pad:-1]
    return [sum(padded[start:start + window]) / window for start in range(len(values))]


def in_place(positions, window):
    """Root travel taken out so the clip plays on the spot.

    The recipe is sway_only in tools/anim/retarget.py: the straight line
    through the end samples removes the distance covered per cycle, and the
    moving average then takes the slower wandering off the longer clips. Only
    the horizontal axes are touched, the vertical rise and fall is the walk.
    """
    pinned = [position.copy() for position in positions]
    span = max(len(positions) - 1, 1)
    for axis in HORIZONTAL_AXES:
        travelled = [position[axis] for position in positions]
        straight = [travelled[0] + (travelled[-1] - travelled[0]) * index / span
                    for index in range(len(travelled))]
        swayed = [value - line for value, line in zip(travelled, straight)]
        for position, value, mean in zip(pinned, swayed, moving_average(swayed, window)):
            position[axis] = value - mean
    return pinned


def key_rotations(bone, track, rest):
    previous = None
    for key in track.frames:
        animated = Quaternion(key.rot).to_matrix().to_4x4()
        if track.bone_id == ROOT_BONE:
            animated = IFP_TO_MODEL @ animated
        rotation = (BONE_TO_FRAME.inverted() @ rest.inverted()
                    @ animated @ BONE_TO_FRAME).to_quaternion()
        # Neighbouring keys on opposite hemispheres would make the player take
        # the long way round between them.
        if previous is not None and previous.dot(rotation) < 0:
            rotation.negate()
        previous = rotation
        bone.rotation_quaternion = rotation
        bone.keyframe_insert('rotation_quaternion', frame=key.time * CLIP_FPS)


def key_root_travel(bone, track, rest, frame):
    keys = [key for key in track.frames if key.pos]
    duration = keys[-1].time - keys[0].time
    window = min(round(SWAY_WINDOW_SECONDS * len(keys) / duration) if duration else 1,
                 len(keys)) | 1
    to_bone = (rest.to_3x3() @ BONE_TO_FRAME.to_3x3()).inverted()
    positions = in_place([IFP_TO_MODEL @ Vector(key.pos) for key in keys], window)
    for key, position in zip(keys, positions):
        bone.location = to_bone @ (position - Vector(frame.position))
        bone.keyframe_insert('location', frame=key.time * CLIP_FPS)


def build_clip(rig, clump, animation):
    """One .ifp animation as an action on the model's own skeleton."""
    frame_by_bone = {frame.bone_id: frame for frame in clump.frames if frame.bone_id >= 0}
    rig.animation_data_create()
    action = bpy.data.actions.new(animation.name)
    rig.animation_data.action = action
    for track in animation.bones:
        frame = frame_by_bone.get(track.bone_id)
        if frame is None or not track.frames:
            continue
        rest = local_matrix(frame).to_3x3().to_4x4()
        bone = rig.pose.bones[frame.name]
        bone.rotation_mode = 'QUATERNION'
        key_rotations(bone, track, rest)
        if track.bone_id == ROOT_BONE and track.has_translation:
            key_root_travel(bone, track, rest, frame)
    # Parked on a muted NLA track: that is what the glTF exporter turns into
    # one named animation each, and it leaves the model in its rest pose.
    strip = rig.animation_data.nla_tracks.new()
    strip.name = animation.name
    strip.strips.new(animation.name, 0, action)
    strip.mute = True
    rig.animation_data.action = None


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    clump = load_dff(args.dff)
    textures = json.loads(args.textures.read_text()) if args.textures else {}

    world = frame_matrices(clump)
    placements = atomic_placements(clump, world)
    lift = Matrix() if args.prop else stand_on_ground(clump, placements)
    rig = build_armature(clump, world, lift @ MODEL_TO_BLENDER)
    for atomic, placement in zip(clump.atomics, placements):
        geometry = clump.geometries[atomic.geometry]
        model = build_mesh(geometry, lift @ placement,
                           build_materials(geometry.materials, textures),
                           part_name(clump, atomic, geometry))
        if geometry.skin:
            bind_skin(model, rig, clump, geometry.skin)
    print(f'BUILT {args.dff.name}: {len(clump.bones)} bones, {len(clump.atomics)} atomics, '
          f'{len(textures)} textures')

    wanted = [name.strip() for name in args.clips.split(',') if name.strip()]
    available = {animation.name.casefold(): animation
                 for animation in (load_ifp(args.ifp) if wanted else [])}
    clips = 0
    for name in wanted:
        animation = available.get(name.casefold())
        if animation is None:
            print(f'MISSING {name}: no such animation in {args.ifp.name}')
            continue
        build_clip(rig, clump, animation)
        clips += 1
        print(f'CLIP {animation.name}: {animation.duration:.2f}s, {len(animation.bones)} bones')

    args.glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.fps = CLIP_FPS
    bpy.ops.export_scene.gltf(filepath=str(args.glb), export_format='GLB', export_yup=True,
                              export_animations=bool(clips),
                              export_animation_mode='NLA_TRACKS',
                              export_force_sampling=True)
    print('EXPORTED', args.glb, f'with {clips} clips')


if __name__ == '__main__':
    main()
