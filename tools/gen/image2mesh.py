#!/usr/bin/env python3
"""Шаг 1 пайплайна: картинка -> GLB-меш через бесплатные HF Spaces.

Использование:
    pip install gradio_client            # один раз
    python3 tools/gen/image2mesh.py input.png output.glb [--space trellis|hunyuan]

Провайдеры (в порядке приоритета, см. docs/PIPELINE.md):
    trellis  -> JeffreyXiang/TRELLIS      (проверен вручную дважды: Берлинец, Bold Raver)
    hunyuan  -> tencent/Hunyuan3D-2       (качественная альтернатива)

Это бесплатные публичные очереди: генерация может занять минуты и Space может
быть перегружен/спать. Скрипт честно печатает прогресс и падает с понятной
ошибкой. Если сигнатура API у Space поменялась — скрипт печатает актуальный
view_api(), чтобы агент сразу увидел новые эндпоинты и поправил вызов.

После получения GLB: авториг (_other/auto-rig/step1_rig.py + step2_weights.py),
анимации (tools/anim/bvh2clip), постобработка (tools/postprocess.mjs).
"""
import argparse
import shutil
import sys
from pathlib import Path

try:
    from gradio_client import Client, handle_file
except ImportError:
    sys.exit('gradio_client не установлен. Выполни: pip install gradio_client')

SPACES = {
    'trellis': 'JeffreyXiang/TRELLIS',
    'hunyuan': 'tencent/Hunyuan3D-2',
}


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
    result = client.predict(
        mesh_simplify=0.95,
        texture_size=1024,
        api_name='/extract_glb',
    )
    # result: (model_path_dict, download_path) — берём последний str/датафайл
    return pick_glb(result)


def run_hunyuan(client, image_path):
    """Hunyuan3D-2: shape+texture одной ручкой /generation_all."""
    image = handle_file(image_path)
    result = client.predict(
        caption='',
        image=image,
        steps=30,
        guidance_scale=5.5,
        seed=1234,
        octree_resolution='256',
        check_box_rembg=True,
        api_name='/generation_all',
    )
    return pick_glb(result)


def pick_glb(result):
    """Ищет путь к .glb в ответе gradio (может быть str, dict или tuple)."""
    def candidates(node):
        if isinstance(node, str):
            yield node
        elif isinstance(node, dict):
            yield from candidates(node.get('value'))
            yield from candidates(node.get('path'))
            yield from candidates(node.get('name'))
        elif isinstance(node, (list, tuple)):
            for item in node:
                yield from candidates(item)

    for path in candidates(result):
        if path and path.endswith('.glb') and Path(path).exists():
            return path
    raise RuntimeError(f'GLB не найден в ответе Space: {result!r}')


RUNNERS = {'trellis': run_trellis, 'hunyuan': run_hunyuan}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('image', help='картинка персонажа (T-поза, светлый фон — см. PIPELINE.md §0)')
    p.add_argument('output', help='куда положить GLB')
    p.add_argument('--space', choices=SPACES, default='trellis')
    args = p.parse_args()

    image_path = Path(args.image).resolve()
    if not image_path.exists():
        sys.exit(f'Картинка не найдена: {image_path}')

    space = SPACES[args.space]
    print(f'[1/3] Подключаюсь к {space} (публичная очередь, может ждать)...')
    client = Client(space)

    print('[2/3] Генерация (минуты; очередь бесплатного Space)...')
    try:
        glb = RUNNERS[args.space](client, str(image_path))
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
