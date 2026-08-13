#!/usr/bin/env python3
"""Шаг 0 пайплайна локально: текст -> PNG на голом CPU, без облака и без NVIDIA.

Локальная пара к `text2image.py` (тот ходит в бесплатную очередь HF): когда
интернета нет или очередь лежит. После первой загрузки весов интернет не нужен
вообще.

Модель: Stable Diffusion 1.5 в fp32 плюс LCM-LoRA, которая сводит число шагов
диффузии с двадцати пяти до шести. Почему именно она:

- SD-Turbo отпадает по арифметике весов. У него архитектура SD 2.1, где текстовый
  энкодер OpenCLIP-H в три раза тяжелее нашего CLIP-L, и в fp32 набегает 5.2 ГБ
  против 4.3 ГБ у SD 1.5. SDXL-Turbo с UNet на 2.6 миллиарда параметров не влезает
  в машину даже близко.
- Половинная точность отпадает по замеру: в bf16 шаг диффузии считался дольше
  десяти минут против 31 секунды в fp32. У Tiger Lake нет ни AVX512-BF16, ни
  быстрого fp16, поэтому половинная точность тут не экономия, а эмуляция.
- Гонять SD 1.5 штатными двадцатью пятью шагами это 13 минут на картинку, поэтому
  LCM-LoRA обязательна, а не украшение.

Стиль в промпт дописывает `prompt_style.py`, он же единственное место, где стиль
вообще описан словами. Пользователь задаёт только суть.

Персонаж рисуется не с чистого шума, а поверх болванки из `scaffold.py`, в режиме
img2img: T-поза словами от модели не добивается, а от геометрии наследуется сама.
Предмету болванка вредна, и это проверено, поэтому он идёт с чистого шума, а его
кадр правится после генерации расчётом в `framing.py`. Подробности там же, в
докстрингах обоих модулей.

Веса берутся в fp32 и подключаются через mmap: файловые страницы ядро выбрасывает
под давлением само, поэтому анонимной памяти прогон занимает около полутора
гигабайт и живёт рядом с открытым браузером. Плата за это в скорости, цифры и
причины в docs/rules/text2image-local.md.

Подготовка окружения (один раз, 1 ГБ venv плюс 4 ГБ весов на диске):
    uv venv --python 3.12 _other/sd-local/venv
    uv pip install --python _other/sd-local/venv/bin/python torch \\
        --index-url https://download.pytorch.org/whl/cpu
    uv pip install --python _other/sd-local/venv/bin/python \\
        diffusers transformers accelerate peft safetensors pillow

Использование:
    _other/sd-local/venv/bin/python tools/gen/text2image_local.py \\
        "stack of sandbags" _other/incoming/sandbags.png --preset prop

Дальше картинка идёт в `triposr_local.py` или `image2mesh.py`.
"""
import argparse
import gc
import os
import re
import sys
import threading
import time
from math import ceil
from pathlib import Path

# httpx внутри huggingface_hub не понимает схему socks:// и падает ещё до запроса,
# а в системе прописан SOCKS-прокси. HTTP-прокси из остальных переменных остаётся.
for socks_var in ('ALL_PROXY', 'all_proxy'):
    os.environ.pop(socks_var, None)

REPO_ROOT = Path(__file__).resolve().parents[2]
WEIGHTS_DIR = REPO_ROOT / '_other' / 'local-gen' / 'weights'
os.environ.setdefault('HF_HOME', str(WEIGHTS_DIR))

sys.path.insert(0, str(Path(__file__).resolve().parent))
import framing  # noqa: E402
import scaffold  # noqa: E402
from prompt_style import build  # noqa: E402

BASE_MODEL = 'stable-diffusion-v1-5/stable-diffusion-v1-5'
LCM_LORA = 'latent-consistency/lcm-lora-sdv1-5'
# Веса качаются сразу в fp32, хотя половинные вдвое меньше. Причина в памяти, а
# не в качестве: fp16-файл пришлось бы поднимать до fp32 в оперативке, и это была
# бы анонимная копия на 3.4 ГБ. Файл нужной точности отображается в память как
# есть, страницы остаются файловыми, и ядро выбрасывает их под давлением само.
WEIGHT_PATTERNS = ['model_index.json', 'scheduler/*', 'tokenizer/*', 'feature_extractor/*',
                   '*/config.json', 'unet/diffusion_pytorch_model.safetensors',
                   'vae/diffusion_pytorch_model.safetensors', 'text_encoder/model.safetensors']
SIDE = 512
STEPS = 6
GUIDANCE = 1.8
SEED = 7
STRENGTH = 0.75
THREADS = 4
MEMORY_FLOOR_MB = 250
ANONYMOUS_MB = 1800
SAMPLE_SECONDS = 2
WINDOW_LIMIT = 2
CYRILLIC = re.compile('[а-яёА-ЯЁ]')


def meminfo_available_mb():
    with open('/proc/meminfo') as f:
        for line in f:
            if line.startswith('MemAvailable:'):
                return int(line.split()[1]) // 1024
    return 0


def self_memory_mb():
    """Весь RSS и его анонимная часть.

    Считать надо обе. Веса лежат в памяти файловыми страницами: они видны в RSS,
    но ядро выбрасывает их под давлением без swap, и на соседний браузер они не
    давят. Давит анонимная часть, поэтому решения принимаются по ней.
    """
    values = {}
    with open('/proc/self/status') as f:
        for line in f:
            name = line.split(':')[0]
            if name in ('VmRSS', 'RssAnon'):
                values[name] = int(line.split()[1]) // 1024
    return values.get('VmRSS', 0), values.get('RssAnon', 0)


class MemoryGuard:
    """Обрывает прогон, если свободной памяти в системе осталось меньше порога."""

    def __init__(self, floor_mb):
        self.floor_mb = floor_mb
        self.peak_mb = 0
        self.peak_anon_mb = 0
        threading.Thread(target=self._watch, daemon=True).start()

    def _watch(self):
        while True:
            rss, anon = self_memory_mb()
            self.peak_mb = max(self.peak_mb, rss)
            self.peak_anon_mb = max(self.peak_anon_mb, anon)
            available = meminfo_available_mb()
            if available < self.floor_mb:
                print(
                    f'\nОстановлено сторожем памяти: свободно {available} МБ при пороге '
                    f'{self.floor_mb} МБ, пик прогона {self.peak_mb} МБ '
                    f'(анонимных {self.peak_anon_mb} МБ). Закрой лишнее и запусти снова.',
                    file=sys.stderr, flush=True,
                )
                os._exit(3)
            time.sleep(SAMPLE_SECONDS)


def weights():
    """Пути к весам: сеть трогаем, только если их ещё нет на диске."""
    from huggingface_hub import hf_hub_download, snapshot_download

    def fetch(offline):
        base = snapshot_download(BASE_MODEL, allow_patterns=WEIGHT_PATTERNS,
                                 ignore_patterns=['safety_checker/*'], local_files_only=offline)
        lora = hf_hub_download(LCM_LORA, 'pytorch_lora_weights.safetensors',
                               local_files_only=offline)
        return base, lora

    try:
        return fetch(offline=True)
    except Exception:  # noqa: BLE001
        print(f'Весов нет на диске, качаю в {os.environ["HF_HOME"]}: около 2 ГБ, один раз.',
              flush=True)
        return fetch(offline=False)


def windows_of(tokenizer, text):
    """Режет текст на окна CLIP по 75 токенов: больше энкодер за раз не принимает."""
    size = tokenizer.model_max_length - 2
    ids = tokenizer(text, truncation=False, add_special_tokens=False).input_ids
    return [ids[start:start + size] for start in range(0, len(ids), size)] or [[]]


def encode_long(pipe, text, needed, torch):
    """Кодирует промпт длиннее 77 токенов окнами, вместо того чтобы его обрезать.

    Штатный энкодер молча отрезает хвост, то есть выбрасывает как раз последние
    требования к позе. Окна кодируются по отдельности и склеиваются по оси
    последовательности, как это делают A1111 и compel. У промпта и негатива окон
    должно быть поровну, недостающие добиваются пустыми.
    """
    tokenizer = pipe.tokenizer
    size = tokenizer.model_max_length - 2
    chunks = windows_of(tokenizer, text)
    chunks += [[]] * (needed - len(chunks))
    embeds = [
        pipe.text_encoder(torch.tensor([
            [tokenizer.bos_token_id] + chunk
            + [tokenizer.eos_token_id] * (size - len(chunk) + 1)
        ]))[0]
        for chunk in chunks
    ]
    return torch.cat(embeds, dim=1)


def measure(prompt, negative):
    """Длина обеих строк в окнах CLIP: за два окна заходить нельзя, модель глохнет."""
    from transformers import CLIPTokenizer

    base, _ = weights()
    tokenizer = CLIPTokenizer.from_pretrained(base, subfolder='tokenizer')
    counts = [len(windows_of(tokenizer, text)) for text in (prompt, negative)]
    verdict = 'в норме' if max(counts) <= WINDOW_LIMIT else 'ПЕРЕБОР, укоротить пресет'
    return f'Окон CLIP: {counts[0]} у промпта, {counts[1]} у негатива ({verdict}).'


def load_pipeline(base, torch):
    """Собирает пайплайн без UNet: это самая тяжёлая часть, и она грузится позже.

    Текстовый энкодер (0.5 ГБ) и UNet (3.4 ГБ) в памяти не пересекаются, поэтому
    пик прогона падает примерно на 700 МБ, а на этой машине это разница между
    работой и swap.
    """
    from diffusers import LCMScheduler, StableDiffusionPipeline

    pipe = StableDiffusionPipeline.from_pretrained(
        base, torch_dtype=torch.float32, unet=None,
        safety_checker=None, requires_safety_checker=False,
    )
    pipe.scheduler = LCMScheduler.from_config(pipe.scheduler.config)
    pipe.set_progress_bar_config(disable=True)
    return pipe


def encode_prompts(pipe, prompt, negative, torch):
    """Кодирует обе строки и выкидывает текстовый энкодер: дальше он не нужен."""
    needed = max(len(windows_of(pipe.tokenizer, prompt)),
                 len(windows_of(pipe.tokenizer, negative)))
    with torch.no_grad():
        embeds = (encode_long(pipe, prompt, needed, torch),
                  encode_long(pipe, negative, needed, torch))
    pipe.text_encoder = None
    gc.collect()
    return embeds, needed


def attach_unet(pipe, base, lora, torch):
    """Догружает UNet и вешает на него LCM-LoRA, не трогая сами веса.

    LoRA сознательно не впаивается в веса. Впайка переписывает тензоры на месте,
    а переписанная страница mmap перестаёт быть файловой и превращается в
    анонимную копию, то есть ровно в то, от чего мы уходим. Дельты считаются на
    лету, это несколько процентов времени против трёх с лишним гигабайт памяти.

    Ни channels_last, ни прочая перекладка тензоров тут тоже недопустима: она
    копирует веса целиком. Экономия памяти куплена ценой шага, см. замеры в
    docs/rules/text2image-local.md.

    Нарезка внимания (`enable_attention_slicing`) здесь только вредит: на CPU она
    считает внимание кусками и роняет скорость, а экономит копейки, потому что
    после перехода на mmap анонимной памяти и так остаётся около половины
    гигабайта.
    """
    from diffusers import UNet2DConditionModel

    pipe.unet = UNet2DConditionModel.from_pretrained(
        base, subfolder='unet', torch_dtype=torch.float32,
    )
    pipe.load_lora_weights(lora)
    gc.collect()


def denoise(pipe, template, strength, common):
    """Гонит диффузию: с болванкой поверх неё, без болванки с чистого шума."""
    if template is None:
        return pipe(**common).images

    from diffusers import StableDiffusionImg2ImgPipeline

    img2img = StableDiffusionImg2ImgPipeline.from_pipe(pipe)
    return img2img(image=template, strength=strength, **common).images


def planned_steps(steps, template, strength):
    """Сколько шагов будет на самом деле: img2img проходит только часть пути."""
    if template is None:
        return steps, steps
    scheduled = ceil(steps / strength)
    return scheduled, int(scheduled * strength)


def decode(pipe, latents, torch):
    """Разворачивает латент в картинку, освободив UNet: иначе пик приходится сюда."""
    pipe.unet = None
    gc.collect()
    with torch.no_grad():
        decoded = pipe.vae.decode(latents / pipe.vae.config.scaling_factor, return_dict=False)[0]
    return pipe.image_processor.postprocess(decoded, output_type='pil')[0]


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument('prompt', help='только суть и только по-английски: '
                   '"stack of sandbags", "raver in a gas mask"')
    p.add_argument('output', help='куда положить PNG')
    p.add_argument('--preset', choices=('prop', 'character'), default='prop',
                   help='предмет или персонаж; персонаж всегда рисуется в T-позе')
    p.add_argument('--no-tpose', action='store_true',
                   help='снять пресет T-позы, только чтобы сравнить «с правилами и без»')
    p.add_argument('--print-prompt', action='store_true',
                   help='напечатать готовый промпт для чужого генератора и выйти')
    p.add_argument('--seed', type=int, default=SEED)
    p.add_argument('--steps', type=int, default=STEPS, help='шаги LCM, рабочий диапазон 4-8')
    p.add_argument('--guidance', type=float, default=GUIDANCE,
                   help='ниже 1.1 негативный промпт перестаёт действовать')
    p.add_argument('--side', type=int, default=SIDE, help='сторона квадратного кадра')
    p.add_argument('--strength', type=float, default=None,
                   help='насколько сильно перерисовывать болванку T-позы, 0.6-0.85')
    p.add_argument('--threads', type=int, default=THREADS)
    p.add_argument('--memory-floor', type=int, default=MEMORY_FLOOR_MB,
                   help='порог MemAvailable в МБ, ниже которого прогон обрывается')
    args = p.parse_args()

    if CYRILLIC.search(args.prompt):
        print('Внимание: CLIP понимает только английский, кириллица в описании даёт мусор. '
              'Суть писать по-английски: "stack of sandbags".', flush=True)

    prompt, negative = build(args.prompt, args.preset, tpose=not args.no_tpose)
    if args.print_prompt:
        print(prompt)
        print()
        print(f'NEGATIVE: {negative}')
        print()
        print(measure(prompt, negative))
        return

    available = meminfo_available_mb()
    needed = ANONYMOUS_MB + args.memory_floor
    if available < needed:
        sys.exit(f'Свободно {available} МБ, а прогону нужно {needed} МБ: своей памяти '
                 f'{ANONYMOUS_MB} МБ плюс запас {args.memory_floor} МБ. Закрой лишнее и '
                 'запусти снова.')

    posed = args.preset == 'character' and not args.no_tpose
    template = scaffold.character(args.side) if posed else None
    strength = STRENGTH if args.strength is None else args.strength
    scheduled, steps = planned_steps(args.steps, template, strength)

    total = steps + 3
    start = time.time()
    cpu_start = time.process_time()
    done = 0

    def report(text):
        nonlocal done
        done += 1
        rss, anon = self_memory_mb()
        print(f'[{done}/{total}] {time.time() - start:6.1f}с RSS {rss / 1024:.1f} ГБ '
              f'(аноним {anon / 1024:.1f} ГБ) | {text}', flush=True)

    import torch

    torch.set_num_threads(args.threads)
    guard = MemoryGuard(args.memory_floor)

    base, lora = weights()
    report('веса на месте')

    pipe = load_pipeline(base, torch)
    (embeds, negative_embeds), windows = encode_prompts(pipe, prompt, negative, torch)
    attach_unet(pipe, base, lora, torch)
    report(f'модель собрана, промпт закодирован (окон CLIP: {windows})')

    def on_step(pipeline, step, timestep, kwargs):
        report(f'шаг диффузии {step + 1} из {steps}')
        return kwargs

    common = dict(
        prompt_embeds=embeds, negative_prompt_embeds=negative_embeds,
        num_inference_steps=scheduled, guidance_scale=args.guidance,
        generator=torch.Generator('cpu').manual_seed(args.seed),
        callback_on_step_end=on_step, output_type='latent',
    )
    if template is None:
        common |= dict(width=args.side, height=args.side)
    latents = denoise(pipe, template, strength, common)
    image, cropped = framing.square(decode(pipe, latents, torch))
    if cropped:
        print('Предмет упирается в край кадра: часть его не нарисована. '
              'Для генератора мешей такая картинка не годится, смени --seed.', flush=True)

    out = Path(args.output).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    report(f'готово: {out} ({out.stat().st_size / 1024:.0f} КБ), пик {guard.peak_mb} МБ, '
           f'из них анонимных {guard.peak_anon_mb} МБ, '
           f'процессорного времени {time.process_time() - cpu_start:.0f}с')


if __name__ == '__main__':
    main()
