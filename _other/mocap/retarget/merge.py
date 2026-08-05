"""Сборка единого GLB: меш+риг из walk.glb, все mocap-клипы и самописные Idle/Aim.

Запуск: blender --background --python merge.py
"""
import bpy

RETARGET_DIR = '/home/anton-matzkaim/rave-land/_other/mocap/retarget'
SOURCES = [
    (f'{RETARGET_DIR}/walk/walk.glb', ['Walk', 'WalkAngry', 'WalkTired', 'WalkFeminine']),
    (f'{RETARGET_DIR}/run/run.glb', ['Run']),
    (f'{RETARGET_DIR}/dance/dance.glb', ['Dance', 'DanceLong']),
    ('/home/anton-matzkaim/rave-land/public/assets/models/character-animated.glb', ['Idle', 'Aim']),
]
TRACK_ORDER = ['Idle', 'Walk', 'WalkAngry', 'WalkTired', 'WalkFeminine', 'Run', 'Aim', 'Dance', 'DanceLong']
OUTPUT = f'{RETARGET_DIR}/merged.glb'


def base_name(action):
    name = action.name
    if name.rsplit('.', 1)[-1].isdigit():
        name = name.rsplit('.', 1)[0]
    return name.removesuffix('_Rig')


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30

collected = {}
base_objects = None

for index, (path, wanted) in enumerate(SOURCES):
    objects_before = set(bpy.data.objects)
    actions_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    new_objects = set(bpy.data.objects) - objects_before
    new_actions = set(bpy.data.actions) - actions_before

    for action in new_actions:
        clip = base_name(action)
        if clip in wanted and clip not in collected:
            action.use_fake_user = True
            collected[clip] = action

    if index == 0:
        base_objects = new_objects
    else:
        for obj in new_objects:
            bpy.data.objects.remove(obj, do_unlink=True)

missing = [clip for clip in TRACK_ORDER if clip not in collected]
if missing:
    raise RuntimeError(f'не найдены клипы: {missing}')

rig = next(obj for obj in base_objects if obj.type == 'ARMATURE')
rig.animation_data_clear()
rig.animation_data_create()
for clip in TRACK_ORDER:
    action = collected[clip]
    action.name = clip
    track = rig.animation_data.nla_tracks.new()
    track.name = clip
    track.strips.new(clip, int(action.frame_range[0]), action)

bpy.ops.export_scene.gltf(
    filepath=OUTPUT,
    export_format='GLB',
    export_animation_mode='NLA_TRACKS',
    export_skins=True,
    export_apply=False,
)
print('written', OUTPUT, 'clips:', TRACK_ORDER)
