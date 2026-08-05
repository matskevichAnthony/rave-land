#!/usr/bin/env python3
"""Маршрут L1: картинка -> GLB локально на CPU через TripoSR, без облака и без NVIDIA.

Запасной вариант к `image2mesh.py` (тот ходит в HF Spaces): когда очередь Space
лежит или интернета нет. Качество ниже, зато не зависит ни от кого. Пропы
выходят заметно лучше персонажей, детали и замеры в F-001 и F-019.

Штатный `TripoSR/run.py` на слабой машине убивается по памяти ещё на загрузке
весов: `TSR.from_pretrained` аллоцирует модель со случайными весами (1.7 ГБ
fp32), а потом читает в память чекпоинт (ещё 1.7 ГБ). Здесь чекпоинт открывается
через mmap, а `load_state_dict(assign=True)` подменяет тензоры модели на
mmap-вью: страницы приходят из page cache и вытесняются под давлением памяти.
Пик падает с 3.4 до 2.2 ГБ, и прогон помещается в 7.6 ГБ RAM без swap-шторма.

Сторож памяти включён всегда: если MemAvailable проваливается ниже порога,
прогон обрывается сам, чтобы не утащить машину в OOM. Живому пользователю за
этой же машиной это важнее, чем досчитанный меш.

Подготовка окружения (один раз, около 3 ГБ на диске):
    cd _other/local-gen
    git clone https://github.com/VAST-AI-Research/TripoSR.git
    uv python install 3.12          # нужны заголовки Python, python3.12-dev без sudo не поставить
    uv venv --python cpython-3.12 venv
    uv pip install --python venv/bin/python torch torchvision \\
        --index-url https://download.pytorch.org/whl/cpu
    uv pip install --python venv/bin/python omegaconf einops transformers==4.35.0 \\
        "numpy==2.4.4" trimesh huggingface-hub rembg onnxruntime xatlas \\
        "scikit-build-core>=0.10" "pybind11>=2.10" cmake ninja
    CMAKE_PREFIX_PATH=$PWD/venv/lib/python3.12/site-packages/torch/share/cmake \\
        uv pip install --python venv/bin/python --no-build-isolation \\
        git+https://github.com/tatsy/torchmcubes.git

Использование:
    cd _other/local-gen
    HF_HOME=$PWD/weights ./venv/bin/python ../../tools/gen/triposr_local.py \\
        <картинка> out/<имя>.glb --mc-resolution 256

Дальше как в маршруте A: decimate до бюджета, авториг (только для персонажей),
`tools/postprocess.mjs`. В `provenance.model` записать «TripoSR local (CPU)».
"""
import argparse
import os
import sys
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
TRIPOSR_DIR = REPO_ROOT / '_other' / 'local-gen' / 'TripoSR'
REPO = 'stabilityai/TripoSR'
MEMORY_FLOOR_MB = 250
SAMPLE_SECONDS = 2


def meminfo_available_mb():
    with open('/proc/meminfo') as f:
        for line in f:
            if line.startswith('MemAvailable:'):
                return int(line.split()[1]) // 1024
    return 0


def self_rss_mb():
    with open('/proc/self/status') as f:
        for line in f:
            if line.startswith('VmRSS:'):
                return int(line.split()[1]) // 1024
    return 0


class MemoryGuard:
    """Обрывает прогон, если свободной памяти в системе осталось меньше порога."""

    def __init__(self, floor_mb):
        self.floor_mb = floor_mb
        self.peak_mb = 0
        threading.Thread(target=self._watch, daemon=True).start()

    def _watch(self):
        while True:
            self.peak_mb = max(self.peak_mb, self_rss_mb())
            available = meminfo_available_mb()
            if available < self.floor_mb:
                print(
                    f'\nОстановлено сторожем памяти: свободно {available} МБ при пороге '
                    f'{self.floor_mb} МБ, пик прогона {self.peak_mb} МБ. '
                    'Закрой браузер и запусти снова либо снизь --mc-resolution.',
                    file=sys.stderr, flush=True,
                )
                os._exit(3)
            time.sleep(SAMPLE_SECONDS)


def load_model(torch):
    """Собирает TSR и заменяет веса на mmap-вью чекпоинта, без второй копии в RAM."""
    from huggingface_hub import hf_hub_download
    from omegaconf import OmegaConf
    from tsr.system import TSR

    cfg = OmegaConf.load(hf_hub_download(repo_id=REPO, filename='config.yaml'))
    OmegaConf.resolve(cfg)
    model = TSR(cfg)
    checkpoint = torch.load(
        hf_hub_download(repo_id=REPO, filename='model.ckpt'), map_location='cpu', mmap=True,
    )
    model.load_state_dict(checkpoint, assign=True)
    return model.eval()


def prepare_image(path, foreground_ratio):
    """Убирает фон и вписывает объект в кадр, как это делает штатный run.py."""
    import numpy as np
    import rembg
    from PIL import Image
    from tsr.utils import remove_background, resize_foreground

    image = resize_foreground(
        remove_background(Image.open(path), rembg.new_session()), foreground_ratio,
    )
    rgba = np.array(image).astype(np.float32) / 255.0
    rgb = rgba[:, :, :3] * rgba[:, :, 3:4] + (1 - rgba[:, :, 3:4]) * 0.5
    return Image.fromarray((rgb * 255.0).astype(np.uint8))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('image', help='картинка объекта, правила кадра в docs/PIPELINE.md §0')
    p.add_argument('output', help='куда положить GLB')
    p.add_argument('--mc-resolution', type=int, default=256, help='сетка marching cubes')
    p.add_argument('--chunk-size', type=int, default=4096, help='меньше значит экономнее по RAM')
    p.add_argument('--foreground-ratio', type=float, default=0.85)
    p.add_argument('--threads', type=int, default=2)
    p.add_argument('--memory-floor', type=int, default=MEMORY_FLOOR_MB,
                   help='порог MemAvailable в МБ, ниже которого прогон обрывается')
    args = p.parse_args()

    if not TRIPOSR_DIR.exists():
        sys.exit(f'Нет клона TripoSR в {TRIPOSR_DIR}. Как поставить: докстринг этого файла.')
    sys.path.insert(0, str(TRIPOSR_DIR))

    import torch

    torch.set_num_threads(args.threads)
    guard = MemoryGuard(args.memory_floor)
    start = time.time()

    def stage(text):
        print(f'[{time.time() - start:6.1f}s | RSS {self_rss_mb() / 1024:.2f} ГБ] {text}', flush=True)

    image = prepare_image(args.image, args.foreground_ratio)
    stage('фон убран, картинка готова')

    model = load_model(torch)
    model.renderer.set_chunk_size(args.chunk_size)
    stage('веса подключены через mmap')

    with torch.no_grad():
        scene_codes = model([image], device='cpu')
    stage('инференс закончен, triplane-код готов')

    mesh = model.extract_mesh(scene_codes, True, resolution=args.mc_resolution)[0]
    stage(f'меш извлечён: {len(mesh.vertices)} вершин, {len(mesh.faces)} треугольников')

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    mesh.export(str(out))
    stage(f'сохранено: {out} ({out.stat().st_size / 1024:.0f} КБ), пик {guard.peak_mb} МБ')
    print('Дальше: decimate до бюджета, авториг для персонажей, tools/postprocess.mjs.')


if __name__ == '__main__':
    main()
