"""Веса через водонепроницаемую voxel-копию: на сыром меше из генератора
автовеса падают с Bone Heat, потому что оболочки не связаны между собой.

Запуск: blender -b --python step2_weights.py -- <каталог-рига>
"""
import sys
from pathlib import Path

import bpy

WORK = Path(sys.argv[sys.argv.index('--') + 1]).resolve()

bpy.ops.wm.open_mainfile(filepath=str(WORK / 'rig.blend'))
obj = bpy.data.objects['Character']
arm_obj = bpy.data.objects['Rig']

for vg in list(obj.vertex_groups):
    obj.vertex_groups.remove(vg)

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.duplicate()
proxy = bpy.context.view_layer.objects.active
proxy.name = 'Proxy'
proxy.modifiers.clear()
proxy.parent = None
remesh = proxy.modifiers.new('Voxel', 'REMESH')
remesh.mode = 'VOXEL'
remesh.voxel_size = 0.02
bpy.ops.object.modifier_apply(modifier='Voxel')
print('PROXY_VERTS', len(proxy.data.vertices))

bpy.ops.object.select_all(action='DESELECT')
proxy.select_set(True)
arm_obj.select_set(True)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.parent_set(type='ARMATURE_AUTO')

def unweighted_count(mesh_obj):
    total = 0
    for vert in mesh_obj.data.vertices:
        if not any(g.weight > 0.001 for g in vert.groups):
            total += 1
    return total

proxy_unweighted = unweighted_count(proxy)
print('PROXY_UNWEIGHTED', proxy_unweighted, 'of', len(proxy.data.vertices))

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
dt = obj.modifiers.new('WeightTransfer', 'DATA_TRANSFER')
dt.object = proxy
dt.use_vert_data = True
dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'
dt.layers_vgroup_select_src = 'ALL'
while obj.modifiers[0] != dt:
    bpy.ops.object.modifier_move_up(modifier=dt.name)
bpy.ops.object.datalayout_transfer(modifier=dt.name)
bpy.ops.object.modifier_apply(modifier=dt.name)

bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.object.vertex_group_normalize_all(lock_active=False)
bpy.ops.object.vertex_group_limit_total(limit=4)
bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=0.01)
bpy.ops.object.vertex_group_normalize_all(lock_active=False)

print('CHAR_UNWEIGHTED', unweighted_count(obj), 'of', len(obj.data.vertices))

if obj.parent != arm_obj:
    obj.parent = arm_obj
existing = [m for m in obj.modifiers if m.type == 'ARMATURE']
if existing:
    existing[0].object = arm_obj
else:
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_obj
obj.matrix_parent_inverse = arm_obj.matrix_world.inverted()

bpy.data.objects.remove(proxy, do_unlink=True)
bpy.ops.wm.save_as_mainfile(filepath=str(WORK / 'rig.blend'))
print('SAVED weighted rig.blend')
