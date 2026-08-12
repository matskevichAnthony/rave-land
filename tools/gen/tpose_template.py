"""Болванка в T-позе: пропорции задаёт она, генератор только одевает её.

Словами T-поза от SD 1.5 не добивается. Проверено: с полным списком требований в
промпте и с запретами в негативе модель всё равно рисует руки вдоль тела, а от
слов `reference sheet` начинает рисовать два ракурса рядом. Причина простая:
в обучающих картинках людей в T-позе почти нет, а текстовое условие слабое.

Поэтому поза задаётся не текстом, а геометрией. Скрипт рисует серую фигуру с
руками точно горизонтально, а генератор запускается в режиме img2img поверх неё:
композиция и поза наследуются от болванки, одежда и стиль приходят из промпта.
Так поза перестаёт быть просьбой и становится условием.

Пропорции стандартные для игрового персонажа: рост семь с половиной голов, руки
в стороны на высоте плеч, ноги на ширине плеч, стопы носками вперёд.
"""
from PIL import Image, ImageDraw

BACKGROUND = (198, 198, 200)
BODY = (120, 118, 124)
LIMB = (108, 106, 112)

TOP_MARGIN = 0.09
BOTTOM_MARGIN = 0.07
HEAD_DIAMETER = 0.105
NECK = 0.02
TORSO_WIDTH = 0.14
HIP_LEVEL = 0.5
ARM_SPAN = 0.86
ARM_THICKNESS = 0.052
LEG_WIDTH = 0.062
LEG_GAP = 0.055
FOOT_HEIGHT = 0.028
FOOT_WIDTH = 0.085


def draw(side):
    """Возвращает картинку с болванкой в T-позе на ровном светлом фоне."""
    image = Image.new('RGB', (side, side), BACKGROUND)
    pen = ImageDraw.Draw(image)

    top = TOP_MARGIN * side
    bottom = side - BOTTOM_MARGIN * side
    height = bottom - top
    middle = side / 2

    head = HEAD_DIAMETER * side
    pen.ellipse((middle - head / 2, top, middle + head / 2, top + head), fill=BODY)

    shoulder = top + head + NECK * side
    hip = top + HIP_LEVEL * height
    torso = TORSO_WIDTH * side / 2
    pen.rectangle((middle - torso, shoulder, middle + torso, hip), fill=BODY)

    arm = ARM_THICKNESS * side
    reach = ARM_SPAN * side / 2
    pen.rectangle((middle - reach, shoulder, middle + reach, shoulder + arm), fill=LIMB)

    leg = LEG_WIDTH * side
    gap = LEG_GAP * side / 2
    foot_top = bottom - FOOT_HEIGHT * side
    for direction in (-1, 1):
        inner = middle + direction * gap
        outer = inner + direction * leg
        pen.rectangle((min(inner, outer), hip, max(inner, outer), foot_top), fill=LIMB)
        centre = (inner + outer) / 2
        pen.rectangle((centre - FOOT_WIDTH * side / 2, foot_top,
                       centre + FOOT_WIDTH * side / 2, bottom), fill=BODY)
    return image
