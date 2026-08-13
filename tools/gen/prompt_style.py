"""Единственный источник формулировок промпта для всей генерации картинок.

Стиль игры описан здесь кодом, а не прозой в документации: любой генератор
картинок (локальный `text2image_local.py`, облачный `text2image.py`, ручной
поход в чужой веб-интерфейс) обязан брать текст отсюда, иначе пути расходятся и
на вход генератору мешей приходит фотография. Как это выглядело до правил, видно
на `_other/incoming/sandbags.png`: фотореалистичные мешки с мягкими тенями, из
которых генератору мешей нечего лепить, кроме каши.

Пользователь описывает только суть предмета или персонажа и только по-английски:
`stack of sandbags`, `raver in a gas mask`. CLIP обучен на английском, кириллицу
он крошит в мусорные токены. Стиль, кадр и запреты дописывает инструмент.

Тексты держатся короткими сознательно. CLIP у SD 1.5 принимает 77 токенов за
раз, длинный промпт режется на окна, и чем их больше, тем слабее модель слушает
каждое слово. Проверено: на пяти окнах вместо мешков с песком выходил цветной
шум. Порог такой: промпт и негатив не длиннее двух окон, замер печатает
`--print-prompt`.

Распечатать готовый промпт для чужого генератора:
    _other/sd-local/venv/bin/python tools/gen/text2image_local.py \\
        "stack of sandbags" out.png --preset prop --print-prompt
"""

# Слова тут подобраны прогонами, и каждое выброшенное выбрасывалось за дело:
# «texture» заставляло рисовать образец ткани во весь кадр вместо предмета,
# «screenshot» добавляло чёрные полосы сверху и снизу и рамку по периметру,
# «desaturated» обесцвечивало предмет в серый, хотя у PS1 цвет был.
# Геометрию держит одна фраза, а не три: на «few large flat polygons» вдобавок
# к остальным генератор рисовал голый серый блок вместо предмета.
STYLE = (
    'low poly PS1 game asset, 1998 survival horror video game graphics, '
    'Resident Evil and Silent Hill and Cry of Fear look, '
    'chunky faceted geometry with hard edges and visible polygon facets, '
    'simple painted surfaces, muted earthy colors, flat even lighting'
)

# Фотореализм убивается перечислением ровно тех слов, которыми его обычно зовут:
# генератор тянется к ним сам, потому что фотографий в обучении несравнимо больше,
# чем игровых рендеров 1998 года.
NEGATIVE = (
    'photo, photorealistic, realistic, dslr, film grain, bokeh, depth of field, '
    'hdr, 4k, ray tracing, octane render, unreal engine, '
    'high poly, highly detailed, smooth shading, glossy, reflections, '
    'dramatic lighting, hard shadows, gradient background, scenery, '
    'text, watermark, multiple views, collage, grid, split image, frame, border, '
    'letterbox, black bars, grayscale, monochrome, black and white, '
    'seamless pattern, tiled texture, fabric swatch, wallpaper'
)

# В шаблоне видно, где стоит суть: у предмета в начале, у персонажа после позы.
# SD слушает начало промпта заметно сильнее хвоста, а у персонажа разваливается
# именно поза, поэтому первые слова отданы ей, а не описанию одежды.
# Суть повторяется дважды не для красоты: слов про стиль в промпте вчетверо
# больше, и в одном экземпляре предмет в них тонет.
PROP_FRAME = (
    '{subject}, single {subject} alone on a plain flat light gray background, '
    'one object only, whole object in frame with margins, '
    'three-quarter view, centered'
)

PROP_NEGATIVE = (
    'ground, floor, sky, horizon, terrain, wall, room, '
    'person, human, hands, animal, group of objects, cropped object, close-up'
)

# Каждая формулировка проверяется глазами на готовой картинке, список пунктов
# в docs/rules/text2image-local.md. Порядок не случайный: сначала поза, потом
# кадр, потом фон. Начало промпта весит больше, а разваливалось всё на позе.
CHARACTER_FRAME = (
    'full body {subject} standing in a strict symmetrical T-pose, '
    'arms stretched straight out sideways, '
    'both arms horizontal at shoulder height like the letter T, '
    'palms down, fingers together, legs straight, '
    'feet shoulder width apart pointing forward, '
    'head level, looking at camera, neutral face, '
    'whole body from head to feet, strict front view, '
    'plain flat light gray background, no shadows'
)

# T-поза это не украшение промпта, а условие пригодности меша: на idle-позе
# TripoSR срастил руки с корпусом, на T-позе руки отделились по всей длине
# (замер в F-024). Поэтому запреты позы вынесены отдельным блоком.
CHARACTER_NEGATIVE = (
    'a-pose, arms down, arms bent, arms raised, hands on hips, '
    'holding an object, action pose, walking, sitting, '
    'side view, back view, turnaround, perspective, close-up, portrait, '
    'cropped feet, cropped head, cape, flowing fabric, extra arms'
)

PRESETS = {
    'prop': (PROP_FRAME, PROP_NEGATIVE),
    'character': (CHARACTER_FRAME, CHARACTER_NEGATIVE),
}

# Пресет позы снимается только для сравнения «с правилами и без»: меш из такой
# картинки в пайплайн не идёт.
CHARACTER_FRAME_WITHOUT_POSE = 'full body character, {subject}, standing, centered'


def build(subject, preset, tpose=True):
    """Собирает пару (промпт, негативный промпт) из сути и пресета кадра."""
    frame, negative = PRESETS[preset]
    if preset == 'character' and not tpose:
        frame, negative = CHARACTER_FRAME_WITHOUT_POSE, ''
    prompt = frame.format(subject=subject.strip().rstrip(',')) + ', ' + STYLE
    return prompt, ', '.join(p for p in (NEGATIVE, negative) if p)
