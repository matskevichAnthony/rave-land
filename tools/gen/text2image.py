#!/usr/bin/env python3
"""Шаг 0 пайплайна: текст -> PNG через бесплатный HF Space FLUX.1-schnell.

Использование:
    _other/hf-client/venv/bin/python tools/gen/text2image.py "промпт" _other/incoming/sandbags.png

Так сделан концепт техно-рейвера, и так же берётся любая картинка на вход
image2mesh или triposr_local, пока подключённый к агенту генератор картинок
недоступен (F-030).

Своё окружение у скрипта не от хорошей жизни: gradio_client тянет свежий
huggingface-hub, а venv локального TripoSR держится на старом, поэтому облачные
утилиты живут в `_other/hf-client/venv`, а локальные в `_other/local-gen/venv`.
"""
import argparse
import os
import shutil
import sys
import time
from pathlib import Path

# httpx внутри gradio_client не понимает схему socks:// и падает ещё до запроса,
# а в системе прописан SOCKS-прокси. HTTP-прокси из остальных переменных остаётся.
for socks_var in ('ALL_PROXY', 'all_proxy'):
    os.environ.pop(socks_var, None)

try:
    from gradio_client import Client
except ImportError:
    sys.exit('gradio_client не установлен. Выполни: '
             'uv pip install --python _other/hf-client/venv/bin/python gradio_client')

SPACE = 'black-forest-labs/FLUX.1-schnell'
SIDE = 1024
STEPS = 4
CONNECT_ATTEMPTS = 4


def connect():
    for attempt in range(1, CONNECT_ATTEMPTS + 1):
        try:
            return Client(SPACE)
        except Exception as exc:  # noqa: BLE001
            print(f'  попытка {attempt}/{CONNECT_ATTEMPTS} не удалась: {exc}', file=sys.stderr)
            if attempt == CONNECT_ATTEMPTS:
                sys.exit(f'Space {SPACE} недоступен: спит, перегружен или сломан.')
            time.sleep(5)


def image_path(result):
    """Путь к PNG из ответа Space: он отдаёт пару (картинка, сид)."""
    node = result[0] if isinstance(result, (list, tuple)) else result
    if isinstance(node, dict):
        node = node.get('path') or node.get('value') or node.get('name')
    if not isinstance(node, str) or not Path(node).exists():
        raise RuntimeError(f'Картинка не найдена в ответе Space: {result!r}')
    return node


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('prompt', help='описание картинки, правила кадра в docs/rules')
    p.add_argument('output', help='куда положить PNG')
    p.add_argument('--seed', type=int, default=0)
    p.add_argument('--side', type=int, default=SIDE, help='сторона квадратного кадра')
    args = p.parse_args()

    print(f'[1/3] Подключаюсь к {SPACE} (публичная очередь, может ждать)...')
    client = connect()

    print('[2/3] Рисую...')
    try:
        result = client.predict(
            prompt=args.prompt,
            seed=args.seed,
            randomize_seed=False,
            width=args.side,
            height=args.side,
            num_inference_steps=STEPS,
            api_name='/infer',
        )
    except Exception as exc:  # noqa: BLE001
        print(f'Генерация упала: {exc}', file=sys.stderr)
        print('\n--- Актуальное API этого Space (эндпоинт сменился?) ---', file=sys.stderr)
        client.view_api(all_endpoints=True)
        sys.exit(1)

    out = Path(args.output).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(image_path(result), out)
    print(f'[3/3] Готово: {out}')


if __name__ == '__main__':
    main()
