#!/usr/bin/env python3
"""Шаг 1 пайплайна: картинка -> GLB-меш через бесплатные HF Spaces.

Использование:
    pip install gradio_client            # один раз
    python3 tools/gen/image2mesh.py input.png output.glb [--space trellis|hunyuan]

Провайдеры (см. docs/PIPELINE.md):
    hunyuan  -> tencent/Hunyuan3D-2   по умолчанию. Space живой, сигнатура сверена 05.08.2026.
                                      Ветка с текстурой (/generation_all) в этот день падала
                                      серверным NameError, поэтому есть откат на /shape_generation:
                                      геометрия без текстуры
    trellis  -> JeffreyXiang/TRELLIS  им сделаны оба персонажа вручную, но 05.08.2026 Space
                                      отвечает CONFIG_ERROR. Пробовать, когда починят

Это бесплатные публичные очереди: генерация может занять минуты и Space может
быть перегружен/спать. Скрипт честно печатает прогресс и падает с понятной
ошибкой. Если сигнатура API у Space поменялась — скрипт печатает актуальный
view_api(), чтобы агент сразу увидел новые эндпоинты и поправил вызов.

После получения GLB: авториг (_other/auto-rig/step1_rig.py + step2_weights.py),
анимации (tools/anim/bvh2clip), постобработка (tools/postprocess.mjs).
"""
import argparse
import os
import shutil
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

# httpx внутри gradio_client не понимает схему socks:// и падает ещё до запроса,
# а в системе прописан SOCKS-прокси. HTTP-прокси из остальных переменных остаётся.
for socks_var in ('ALL_PROXY', 'all_proxy'):
    os.environ.pop(socks_var, None)

try:
    from gradio_client import Client, handle_file
except ImportError:
    sys.exit('gradio_client не установлен. Выполни: pip install gradio_client')

SPACES = {
    'trellis': 'JeffreyXiang/TRELLIS',
    'hunyuan': 'tencent/Hunyuan3D-2',
    'hunyuan21': 'tencent/Hunyuan3D-2.1',
}

HUNYUAN_PARAMS = dict(
    mv_image_front=None,
    mv_image_back=None,
    mv_image_left=None,
    mv_image_right=None,
    steps=30,
    guidance_scale=5.5,
    seed=1234,
    octree_resolution=256,
    check_box_rembg=True,
    num_chunks=8000,
    randomize_seed=False,
)


def dump_api(client):
    print('\n--- Актуальное API этого Space (эндпоинты сменились?) ---', file=sys.stderr)
    try:
        client.view_api(all_endpoints=True)
    except Exception as exc:  # noqa: BLE001
        print(f'(view_api тоже упал: {exc})', file=sys.stderr)


def run_trellis(client, image_path):
    """TRELLIS: preprocess -> image_to_3d -> extract_glb. Возвращает путь к GLB."""
    image = handle_file(image_path)
    client.predict(api_name='/start_session')
    processed = client.predict(image=image, api_name='/preprocess_image')
    client.predict(
        image=processed,
        multiimages=[],
        seed=0,
        ss_guidance_strength=7.5,
        ss_sampling_steps=12,
        slat_guidance_strength=3.0,
        slat_sampling_steps=12,
        multiimage_algo='stochastic',
        api_name='/image_to_3d',
    )
    return client.predict(
        mesh_simplify=0.95,
        texture_size=1024,
        api_name='/extract_glb',
    )


def run_hunyuan(client, image_path):
    """Hunyuan3D-2: shape+texture одной ручкой /generation_all.

    Сигнатура сверена с живым Space 05.08.2026. Два расхождения с прежним кодом:
    octree_resolution стал числовым слайдером и строку '256' не принимает, а
    randomize_seed по умолчанию True, то есть переданный seed молча игнорируется
    и прогон невоспроизводим.
    """
    return hunyuan_generate(client, image_path, caption='')


def run_hunyuan21(client, image_path):
    """Hunyuan3D-2.1: те же ручки, но без caption и с PBR-текстурой."""
    return hunyuan_generate(client, image_path)


def hunyuan_generate(client, image_path, **extra):
    params = HUNYUAN_PARAMS | {'image': handle_file(image_path)} | extra
    try:
        return client.predict(**params, api_name='/generation_all')
    except Exception as exc:  # noqa: BLE001
        print(f'  /generation_all упал ({exc}), беру только форму через /shape_generation. '
              f'Текстуры не будет, красить придётся проекцией картинки в Blender.',
              file=sys.stderr)
        return client.predict(**params, api_name='/shape_generation')


def glb_paths(node):
    """Все пути к .glb внутри ответа gradio (str, dict или tuple)."""
    if isinstance(node, str):
        if node.endswith('.glb'):
            yield node
    elif isinstance(node, dict):
        for key in ('value', 'path', 'name'):
            yield from glb_paths(node.get(key))
    elif isinstance(node, (list, tuple)):
        for item in node:
            yield from glb_paths(item)


def fetch_glb(client, result):
    """Локальный путь к GLB из ответа Space, при необходимости скачивая файл.

    Hunyuan отдаёт не FileData, а gr.update со ссылкой на файл внутри контейнера
    Space, поэтому gradio_client такой файл не выкачивает и локально его нет.
    Достаём его штатным файловым маршрутом gradio.
    """
    for path in glb_paths(result):
        if Path(path).exists():
            return path
        url = f'{client.src.rstrip("/")}/file={path}'
        local = Path(tempfile.mkdtemp()) / Path(path).name
        print(f'  файл остался в Space, скачиваю {url}')
        with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT) as response:
            local.write_bytes(response.read())
        return str(local)
    raise RuntimeError(f'GLB не найден в ответе Space: {result!r}')


RUNNERS = {'trellis': run_trellis, 'hunyuan': run_hunyuan, 'hunyuan21': run_hunyuan21}

# Через здешний прокси примерно каждое третье рукопожатие с HF отваливается по таймауту.
CONNECT_ATTEMPTS = 4
DOWNLOAD_TIMEOUT = 300


def connect(space, space_key):
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        try:
            return Client(space)
        except Exception as exc:  # noqa: BLE001
            print(f'  попытка {attempt}/{CONNECT_ATTEMPTS} не удалась: {exc}', file=sys.stderr)
            if attempt == CONNECT_ATTEMPTS:
                others = ' | '.join(key for key in SPACES if key != space_key)
                sys.exit(f'Space {space} недоступен. Он спит, перегружен или сломан. '
                         f'Попробуй другой: --space {others}')
            time.sleep(5)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('image', help='картинка персонажа (T-поза, светлый фон — см. PIPELINE.md §0)')
    p.add_argument('output', help='куда положить GLB')
    p.add_argument('--space', choices=SPACES, default='hunyuan')
    args = p.parse_args()

    image_path = Path(args.image).resolve()
    if not image_path.exists():
        sys.exit(f'Картинка не найдена: {image_path}')

    space = SPACES[args.space]
    print(f'[1/3] Подключаюсь к {space} (публичная очередь, может ждать)...')
    client = connect(space, args.space)

    print('[2/3] Генерация (минуты; очередь бесплатного Space)...')
    try:
        glb = fetch_glb(client, RUNNERS[args.space](client, str(image_path)))
    except Exception as exc:  # noqa: BLE001
        print(f'Генерация упала: {exc}', file=sys.stderr)
        dump_api(client)
        sys.exit(1)

    out = Path(args.output).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(glb, out)
    print(f'[3/3] Готово: {out}')
    print('Дальше: авториг -> анимации -> постобработка (tools/README.md).')


if __name__ == '__main__':
    main()
