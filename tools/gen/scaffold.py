"""Болванка под img2img: позу задаёт геометрия, а не просьба в промпте.

Диффузионная модель плохо слушается слов про позу: с полным списком требований
в промпте и с запретами в негативе она всё равно рисует руки вдоль тела.
Поэтому персонаж генерируется не с чистого шума, а поверх нарисованной здесь
фигуры, в режиме img2img. Поза наследуется от геометрии и перестаёт быть
просьбой.

Предмету такая болванка, наоборот, вредна, и это проверено: гранёная серая
коробка сама по себе идеально отвечает промпту про low poly, поэтому генератор
оставлял её нетронутой даже на strength 0.97, а размытая давала слоёный ком без
материала. Кадр предмета чинится после генерации, расчётом, в `framing.py`.
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


def character(side):
    """Фигура в строгой T-позе: руки точно горизонтально, ноги на ширине плеч.

    Пропорции игрового персонажа: рост семь с половиной голов, стопы носками
    вперёд. Меняются константами выше, других мест с ростом и размахом рук нет.
    """
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
