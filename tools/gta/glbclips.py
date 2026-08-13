#!/usr/bin/env python3
"""Перенести клипы из одного GLB в другой по именам узлов.

    python3 tools/gta/glbclips.py target.glb --from donor.glb

Обычный путь пополнить персонажа клипами это пересобрать его `dff2glb.py` с нужным
набором `--ifp`. Он требует исходный `.dff`, а модели педов в репозитории не лежат:
из ассетов San Andreas тут только `anim.img` и ганпак. Скелет у всех импортированных
педов один и тот же (32 кости San Andreas, имена узлов совпадают побайтово), поэтому
клип переносится сопоставлением по имени узла, ровно как `.ifp` ложится по bone id.
"""
import argparse
import json
import struct
from pathlib import Path

COMPONENT_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
COMPONENT_COUNT = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
ALIGNMENT = 4


def read_glb(path):
    data = path.read_bytes()
    if data[:4] != b'glTF':
        raise SystemExit(f'{path} не похож на GLB')
    document = None
    binary = b''
    offset = 12
    while offset < len(data):
        length, kind = struct.unpack('<II', data[offset:offset + 8])
        chunk = data[offset + 8:offset + 8 + length]
        if kind == JSON_CHUNK:
            document = json.loads(chunk)
        elif kind == BIN_CHUNK:
            binary = chunk
        offset += 8 + length
    return document, bytearray(binary)


def write_glb(path, document, binary):
    text = json.dumps(document, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % ALIGNMENT)
    binary += b'\0' * (-len(binary) % ALIGNMENT)
    total = 12 + 8 + len(text) + 8 + len(binary)
    path.write_bytes(
        struct.pack('<4sII', b'glTF', 2, total)
        + struct.pack('<II', len(text), JSON_CHUNK) + text
        + struct.pack('<II', len(binary), BIN_CHUNK) + bytes(binary))


def accessor_bytes(document, binary, index):
    accessor = document['accessors'][index]
    view = document['bufferViews'][accessor['bufferView']]
    stride = COMPONENT_SIZE[accessor['componentType']] * COMPONENT_COUNT[accessor['type']]
    start = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    return accessor, binary[start:start + stride * accessor['count']]


def copy_accessor(target, target_bin, donor, donor_bin, index, view, memo):
    """Перенести данные аксессора в общий буферный вид и вернуть его новый номер.

    Все перенесённые аксессоры складываются в один вид, а не в свой каждому: пять тысяч
    записей `bufferViews` раздувают JSON-чанк втрое сильнее, чем весят сами данные. По той же
    причине аксессор переносится один раз: 96 каналов клипа делят между собой одну шкалу
    времени, и без памяти о переносе она копируется 96 раз.
    """
    if index in memo:
        return memo[index]
    accessor, payload = accessor_bytes(donor, donor_bin, index)
    padding = -len(target_bin) % ALIGNMENT
    target_bin += b'\0' * padding
    copied = {key: value for key, value in accessor.items()}
    copied['bufferView'] = view
    copied['byteOffset'] = len(target_bin) - target['bufferViews'][view]['byteOffset']
    target_bin += payload
    target['bufferViews'][view]['byteLength'] = len(target_bin) \
        - target['bufferViews'][view]['byteOffset']
    target['accessors'].append(copied)
    memo[index] = len(target['accessors']) - 1
    return memo[index]


def transplant(target, target_bin, donor, donor_bin, wanted, view):
    memo = {}
    nodes = {node.get('name'): index for index, node in enumerate(target['nodes'])}
    present = {clip['name'] for clip in target.setdefault('animations', [])}
    added = []
    for clip in donor.get('animations', []):
        if clip['name'] in present or (wanted and clip['name'] not in wanted):
            continue
        channels = [channel for channel in clip['channels']
                    if donor['nodes'][channel['target']['node']].get('name') in nodes]
        if not channels:
            continue
        used = sorted({channel['sampler'] for channel in channels})
        samplers = []
        for sampler in (clip['samplers'][index] for index in used):
            samplers.append({
                'input': copy_accessor(
                    target, target_bin, donor, donor_bin, sampler['input'], view, memo),
                'output': copy_accessor(
                    target, target_bin, donor, donor_bin, sampler['output'], view, memo),
                'interpolation': sampler.get('interpolation', 'LINEAR'),
            })
        renumbered = {old: new for new, old in enumerate(used)}
        target['animations'].append({
            'name': clip['name'],
            'samplers': samplers,
            'channels': [{
                'sampler': renumbered[channel['sampler']],
                'target': {'node': nodes[donor['nodes'][channel['target']['node']]['name']],
                           'path': channel['target']['path']},
            } for channel in channels],
        })
        added.append(clip['name'])
    return added


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('target', type=Path, help='GLB, который пополняем')
    parser.add_argument('--from', dest='donor', type=Path, required=True,
                        help='GLB-источник клипов')
    parser.add_argument('--clips', default='',
                        help='имена через запятую; по умолчанию все, которых нет в цели')
    args = parser.parse_args()

    target, target_bin = read_glb(args.target)
    donor, donor_bin = read_glb(args.donor)
    wanted = {name for name in args.clips.split(',') if name}
    target_bin += b'\0' * (-len(target_bin) % ALIGNMENT)
    target['bufferViews'].append({'buffer': 0, 'byteOffset': len(target_bin), 'byteLength': 0})
    added = transplant(target, target_bin, donor, donor_bin, wanted,
                       len(target['bufferViews']) - 1)
    target['buffers'][0]['byteLength'] = len(target_bin) + (-len(target_bin) % ALIGNMENT)
    write_glb(args.target, target, target_bin)
    print(f'{args.target.name}: добавлено {len(added)} клипов: {", ".join(added) or "ни одного"}')


if __name__ == '__main__':
    main()
