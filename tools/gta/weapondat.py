#!/usr/bin/env python3
"""weapon.dat из GTA San Andreas -> JSON-каталог для игры.

Игра берёт из этого файла не только баланс, но и поведение: кадры animLoop задают, на
какой позе персонаж держит прицел и какой отрезок клипа проигрывается на выстрел, а
hex-флаги говорят, можно ли целиться и стрелять на ходу и одной ли рукой держится оружие.
Раскладка колонок описана в шапке самого weapon.dat.
"""
import argparse
import json
from pathlib import Path

FLAG_BITS = {
    'canAim': (0, 1), 'aimWithArm': (0, 2), 'firstPerson': (0, 4),
    'moveAim': (1, 1), 'moveFire': (1, 2),
    'throw': (2, 1), 'heavy': (2, 2), 'continuousFire': (2, 4), 'twinPistol': (2, 8),
    'reload': (3, 1), 'crouchFire': (3, 2),
}
SKILL_NAMES = ('poor', 'std', 'pro', 'cop')
GUN_MARKER = '$'
GUN_FIELDS = 26


def flags_of(hex_digits):
    """Флаги лежат по цифрам hex, младшая цифра первая."""
    digits = [int(digit, 16) for digit in reversed(hex_digits)]
    return {name: bool(digits[index] & bit) if index < len(digits) else False
            for name, (index, bit) in FLAG_BITS.items()}


def parse(path):
    weapons, skipped = {}, []
    for line in path.read_text(errors='replace').splitlines():
        fields = line.replace('\r', '').split()
        if not fields or fields[0] != GUN_MARKER or fields[2] == 'PROJECTILE':
            continue
        # У огнемёта, миниган и ракетницы колонок больше, счёт от конца на них не работает.
        # Нам нужно стрелковое со стандартной раскладкой, остальное честно пропускаем.
        if len(fields) != GUN_FIELDS:
            skipped.append(fields[1])
            continue
        # Часть колонок в середине строки необязательна (времена звуков перезарядки),
        # поэтому от начала считаются только общие поля, а всё остальное от конца.
        name, fire_type = fields[1], fields[2]
        skill = int(fields[-12])
        weapons.setdefault(name, {'fireType': fire_type, 'skills': {}})['skills'][
            SKILL_NAMES[skill] if skill < len(SKILL_NAMES) else str(skill)] = {
            'group': fields[-18],
            'targetRange': float(fields[3]),
            'weaponRange': float(fields[4]),
            'magazine': int(fields[-17]),
            'damage': int(fields[-16]),
            'fireOffset': [float(fields[-15]), float(fields[-14]), float(fields[-13])],
            'accuracy': float(fields[-10]),
            'moveSpeed': float(fields[-9]),
            'animLoop': {'start': int(fields[-8]), 'end': int(fields[-7]),
                         'fire': int(fields[-6])},
            'flags': flags_of(fields[-1]),
        }
    if skipped:
        print('пропущено (нестандартная раскладка колонок):', ', '.join(sorted(set(skipped))))
    return weapons


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('dat', type=Path, help='weapon.dat из папки data игры')
    parser.add_argument('-o', '--output', type=Path, required=True, help='JSON на выход')
    parser.add_argument('--only', default='', help='список имён через запятую')
    args = parser.parse_args()

    weapons = parse(args.dat)
    if args.only:
        wanted = {name.strip().upper() for name in args.only.split(',')}
        missing = wanted - set(weapons)
        if missing:
            raise SystemExit(f'нет такого оружия в weapon.dat: {sorted(missing)}')
        weapons = {name: data for name, data in weapons.items() if name in wanted}
    args.output.write_text(json.dumps(weapons, ensure_ascii=False, indent=2) + '\n')
    print(f'{len(weapons)} стволов -> {args.output}')
    for name, data in weapons.items():
        std = data['skills'].get('std') or next(iter(data['skills'].values()))
        loop = std['animLoop']
        print(f"  {name:14s} группа {std['group']:9s} урон {std['damage']:3d} "
              f"магазин {std['magazine']:3d} дальность {std['weaponRange']:5.1f} "
              f"кадры {loop['start']}..{loop['end']} выстрел {loop['fire']} "
              f"одной рукой {'да' if std['flags']['aimWithArm'] else 'нет'}")


if __name__ == '__main__':
    main()
