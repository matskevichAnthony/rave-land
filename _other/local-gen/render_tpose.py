"""Контрольный вход для TripoSR: тот же персонаж, но по правилам PIPELINE §0.

Прошлый замер (F-019) кормил модель кадром `final-idle-front.png`: idle-поза,
руки вдоль тела, тёмная фигура на среднесером фоне. Чтобы отделить «модель не
умеет персонажей» от «вход был негодный», нужен кадр того же персонажа, где
изменены ровно нарушенные правила: строгая T-поза и светлый ровный фон.

`rig.blend` собран по T-позному мешу (см. detect_landmarks в rig_lib.py), так
что его rest-поза уже почти T: руки в стороны, но с наклоном вниз градусов на
пятнадцать. Скрипт доводит их до строгой горизонтали, чтобы под мышками была
полоса фона, а не тень между рукой и корпусом.

    blender --background --python _other/local-gen/render_tpose.py
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

WORK = Path(__file__).resolve().parent
RIG_BLEND = WORK.parent / 'auto-rig' / 'rig.blend'
OUTPUT = WORK / 'tpose-front.png'

BACKGROUND_GRAY = 0.82
AMBIENT_STRENGTH = 1.6
KEY_ENERGY = 2.5
FILL_ENERGY = 1.5
RESOLUTION = 1024
SAMPLES = 48
CAMERA_LENS = 85
CAMERA_DISTANCE = 5.0
BODY_CENTER_Z = 0.9


def straighten_arm(rig, bone_name, direction):
    """Разворачивает кость так, чтобы её rest-направление легло вдоль direction."""
    pose_bone = rig.pose.bones[bone_name]
    rest = (rig.matrix_world @ pose_bone.bone.matrix_local).to_3x3()
    rest_direction = (rest @ Vector((0, 1, 0))).normalized()
    world = rest_direction.rotation_difference(Vector(direction)).to_matrix()
    pose_bone.rotation_mode = 'QUATERNION'
    pose_bone.rotation_quaternion = (rest.inverted() @ world @ rest).to_quaternion()


def add_sun(energy, pitch_deg, yaw_deg):
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = energy
    sun.data.angle = math.radians(30)
    sun.rotation_euler = (math.radians(pitch_deg), 0, math.radians(yaw_deg))
    bpy.context.collection.objects.link(sun)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(RIG_BLEND))
    rig = bpy.data.objects['Rig']
    if rig.animation_data:
        rig.animation_data.action = None
    straighten_arm(rig, 'upper_arm.L', (1, 0, 0))
    straighten_arm(rig, 'upper_arm.R', (-1, 0, 0))

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = SAMPLES
    scene.render.resolution_x = RESOLUTION
    scene.render.resolution_y = RESOLUTION
    scene.render.filepath = str(OUTPUT)

    scene.world = bpy.data.worlds.new('W')
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes['Background']
    background.inputs['Color'].default_value = (BACKGROUND_GRAY,) * 3 + (1,)
    background.inputs['Strength'].default_value = AMBIENT_STRENGTH

    add_sun(KEY_ENERGY, 60, 20)
    add_sun(FILL_ENERGY, 75, -160)

    camera = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
    camera.data.lens = CAMERA_LENS
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    target = Vector((0, 0, BODY_CENTER_Z))
    camera.location = target + Vector((0, -CAMERA_DISTANCE, 0))
    camera.rotation_mode = 'QUATERNION'
    camera.rotation_quaternion = (camera.location - target).to_track_quat('Z', 'Y')

    bpy.ops.render.render(write_still=True)
    print(f'RENDERED {OUTPUT}')


main()
