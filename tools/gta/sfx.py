#!/usr/bin/env python3
"""Архив звуков GTA San Andreas (audio/sfx/genrl и соседние) -> WAV по банкам.

    python3 tools/gta/sfx.py audio/sfx/genrl -o _other/gta-sfx

Внутри архива нет оглавления: банки лежат встык, а их границы игра читает из
audio/config/banklkup.dat. Если этот файл рядом, берём границы оттуда, это точно и
мгновенно. Если архив достался без папки config, границы ищутся сканированием по форме
заголовка (см. `bank_at`); на GENRL оба пути дали одни и те же 137 банков байт в байт.

Звук лежит несжатым PCM 16 бит моно, частота своя у каждого звука.
"""
import argparse
import csv
import struct
import wave
from pathlib import Path

ENTRY_FORMAT = '<IIHH'
ENTRY_SIZE = struct.calcsize(ENTRY_FORMAT)
BANK_ENTRIES = 400
BANK_HEADER_SIZE = 4 + BANK_ENTRIES * ENTRY_SIZE
SAMPLE_WIDTH = 2
# 2021 Гц встречается в архиве всерьёз, так что нижняя граница нарочно щедрая.
SAMPLE_RATE_RANGE = (1000, 48000)
# Кратность смещений банка ничем не гарантирована, но PCM 16 бит выравнивает данные
# по два байта, и все найденные банки это подтверждают.
BANK_ALIGNMENT = 2
# banklkup.dat: номер пака, три байта выравнивания, смещение банка, размер его данных.
LOOKUP_FORMAT = '<BBBBII'
PAK_NAME_SIZE = 52
CONFIG_DIRNAME = 'config'


def sound_table(data, offset):
    """Записи звуков банка по объявленному счётчику, без проверок."""
    count = struct.unpack_from('<H', data, offset)[0]
    table = struct.unpack_from('<' + ENTRY_FORMAT[1:] * count, data, offset + 4)
    return [table[index * 4:index * 4 + 4] for index in range(count)]


def bank_at(data, offset):
    """Записи банка, если по смещению действительно лежит заголовок банка, иначе None.

    Опознание держится на пяти признаках сразу: счётчик звуков в пределах таблицы,
    обнулённый хвост таблицы за счётчиком, первый звук всегда с нулевого байта данных,
    правдоподобные частоты и строго растущие смещения. Поодиночке любой из них
    срабатывает и посреди PCM, вместе не ошиблись ни разу на 25 мегабайтах GENRL.
    """
    if offset + BANK_HEADER_SIZE > len(data):
        return None
    count, padding = struct.unpack_from('<HH', data, offset)
    if not 1 <= count <= BANK_ENTRIES or padding:
        return None
    if data[offset + 4 + count * ENTRY_SIZE:offset + BANK_HEADER_SIZE].strip(b'\0'):
        return None
    entries = sound_table(data, offset)
    if entries[0][0]:
        return None
    previous = -1
    for buffer_offset, _loop, rate, _headroom in entries:
        if not SAMPLE_RATE_RANGE[0] <= rate <= SAMPLE_RATE_RANGE[1]:
            return None
        if buffer_offset <= previous:
            return None
        previous = buffer_offset
    return entries


def scan_banks(data):
    """Список (смещение банка, конец банка, записи) в порядке следования в файле."""
    found = [(offset, entries)
             for offset in range(0, len(data) - BANK_HEADER_SIZE, BANK_ALIGNMENT)
             if (entries := bank_at(data, offset))]
    ends = [start for start, _ in found[1:]] + [len(data)]
    return [(offset, end, entries) for (offset, entries), end in zip(found, ends)]


def pak_numbers(pakfiles):
    """Имя пака в нижнем регистре -> его номер в banklkup.dat."""
    names = pakfiles.read_bytes()
    return {names[start:start + PAK_NAME_SIZE].split(b'\0')[0].decode('latin-1').lower(): number
            for number, start in enumerate(range(0, len(names), PAK_NAME_SIZE))}


def lookup_banks(data, lookup, pak):
    """Банки одного пака по официальной таблице: (смещение, конец, записи).

    Размер в таблице считается без заголовка, поэтому конец банка это смещение плюс
    заголовок плюс объявленный размер данных.
    """
    return [(offset, offset + BANK_HEADER_SIZE + size, sound_table(data, offset))
            for number, _pad_a, _pad_b, _pad_c, offset, size
            in struct.iter_unpack(LOOKUP_FORMAT, lookup.read_bytes()) if number == pak]


def banks_of(data, archive, config):
    """Банки архива и способ, которым найдены их границы."""
    lookup, pakfiles = config / 'banklkup.dat', config / 'pakfiles.dat'
    if not (lookup.exists() and pakfiles.exists()):
        return scan_banks(data), 'сканированием'
    pak = pak_numbers(pakfiles).get(archive.name.lower())
    if pak is None:
        return scan_banks(data), 'сканированием, в pakfiles.dat такого пака нет'
    return lookup_banks(data, lookup, pak), f'по banklkup.dat, пак {pak}'


def sounds_of(data, offset, end, entries):
    """(номер, частота, PCM) каждого звука банка, длина берётся из начала следующего."""
    body = offset + BANK_HEADER_SIZE
    starts = [buffer_offset for buffer_offset, _loop, _rate, _headroom in entries]
    stops = starts[1:] + [end - body]
    return [(index, entry[2], data[body + start:body + stop])
            for index, (entry, start, stop) in enumerate(zip(entries, starts, stops))]


def write_wav(path, rate, pcm):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as out:
        out.setnchannels(1)
        out.setsampwidth(SAMPLE_WIDTH)
        out.setframerate(rate)
        out.writeframes(pcm)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('archive', type=Path, help='архив звуков, например audio/sfx/genrl')
    parser.add_argument('-o', '--output', type=Path, help='куда разложить WAV')
    parser.add_argument('--banks', default='',
                        help='номера банков через запятую, по умолчанию все')
    parser.add_argument('--config', type=Path,
                        help='папка audio/config (по умолчанию соседняя с папкой архива)')
    parser.add_argument('--list', action='store_true',
                        help='только опись, ничего не писать на диск')
    args = parser.parse_args()
    if not args.list and args.output is None:
        parser.error('без --list нужен -o: куда раскладывать WAV')

    data = args.archive.read_bytes()
    config = args.config or args.archive.resolve().parent.parent / CONFIG_DIRNAME
    banks, source = banks_of(data, args.archive, config)
    wanted = {int(number) for number in args.banks.split(',') if number.strip()}
    missing = sorted(number for number in wanted if not 0 <= number < len(banks))
    if missing:
        raise SystemExit(f'в архиве {len(banks)} банков, таких нет: {missing}')
    rows = []
    for bank, (offset, end, entries) in enumerate(banks):
        if wanted and bank not in wanted:
            continue
        for index, rate, pcm in sounds_of(data, offset, end, entries):
            relative = Path(f'bank{bank:03d}') / f'{index:03d}.wav'
            rows.append({'bank': bank, 'sound': index, 'rate': rate,
                         'samples': len(pcm) // SAMPLE_WIDTH,
                         'seconds': round(len(pcm) / SAMPLE_WIDTH / rate, 3),
                         'offset': offset, 'file': str(relative)})
            if not args.list:
                write_wav(args.output / relative, rate, pcm)

    if not args.list:
        with (args.output / 'index.csv').open('w', newline='') as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    seconds = sum(row['seconds'] for row in rows)
    print(f'{args.archive.name}: банков {len(banks)} ({source}), звуков {len(rows)}, '
          f'{seconds / 60:.1f} минут звука'
          + ('' if args.list else f' -> {args.output}'))


if __name__ == '__main__':
    main()
