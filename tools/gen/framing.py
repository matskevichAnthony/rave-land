"""Приводит готовый кадр к тому, что требует генератор мешей.

Композицию генератор держит плохо: предмет уезжает вбок, упирается в край, а
сверху и снизу остаются чёрные полосы. Спорить с ним словами дорого, а посчитать
кадр дёшево, потому что фон по правилам ровный и однотонный.

Порядок такой: срезать однотонную кайму и тем самым найти сам предмет, добрать
вокруг него столько настоящего фона, сколько есть в кадре, и дополнить поля до
квадрата ровным цветом фона. Настоящий фон берётся первым не из экономии: если
залить поля целиком, на месте стыка виден прямоугольник, а удалятель фона на
следующем шаге принимает такой стык за край предмета. Продолжать край вместо
заливки нельзя: у обрезанного предмета оно размазывает его же по всему полю.

Заодно видно, упирался ли предмет в край: если да, часть его генератор не
нарисовал, и такую картинку в генератор мешей пускать нельзя, он достроит
обрубок.
"""
import numpy as np
from PIL import Image

UNIFORM_TOLERANCE = 18
UNIFORM_SHARE = 0.97
BACKGROUND_TOLERANCE = 26
MARGIN = 0.12
EDGE_SLACK = 2


def _uniform(line):
    """Ряд считается однотонным, если почти все пиксели держатся своей медианы.

    Сравнивать крайние значения нельзя: у чёрной полосы по краям сидят пиксели
    рамки, и одна такая пара объявляет полосу разноцветной.
    """
    deviation = np.abs(line - np.median(line, axis=0)).max(axis=1)
    return float((deviation <= UNIFORM_TOLERANCE).mean()) >= UNIFORM_SHARE


def _span(lines):
    """Первый и последний ряд, который не однотонный."""
    first, last = 0, len(lines) - 1
    while first < last and _uniform(lines[first]):
        first += 1
    while last > first and _uniform(lines[last]):
        last -= 1
    return first, last


def object_box(pixels):
    """Границы предмета: однотонная кайма срезается сначала сверху и снизу.

    Порядок обязателен. Чёрные полосы сверху и снизу проходят через все колонки,
    поэтому пока они в кадре, ни одна колонка не однотонная и по горизонтали не
    срезается ничего.
    """
    top, bottom = _span(pixels)
    left, right = _span(pixels[top:bottom + 1].transpose(1, 0, 2))
    top, bottom = _span(pixels[:, left:right + 1])
    return left, top, right, bottom


def background_colour(pixels, box):
    """Цвет фона берётся с кольца вокруг предмета: там он по определению фон."""
    left, top, right, bottom = box
    height, width = pixels.shape[:2]
    ring = [
        pixels[max(top - EDGE_SLACK, 0)], pixels[min(bottom + EDGE_SLACK, height - 1)],
        pixels[:, max(left - EDGE_SLACK, 0)], pixels[:, min(right + EDGE_SLACK, width - 1)],
    ]
    return np.median(np.concatenate(ring), axis=0)


def background_region(pixels, box, colour):
    """Докуда вокруг предмета тянется настоящий фон: границей встают полосы."""
    left, top, right, bottom = box
    height, width = pixels.shape[:2]

    def background(line):
        return float(np.abs(line - colour).max(axis=1).mean()) <= BACKGROUND_TOLERANCE

    while top > 0 and background(pixels[top - 1, left:right + 1]):
        top -= 1
    while bottom < height - 1 and background(pixels[bottom + 1, left:right + 1]):
        bottom += 1
    while left > 0 and background(pixels[top:bottom + 1, left - 1]):
        left -= 1
    while right < width - 1 and background(pixels[top:bottom + 1, right + 1]):
        right += 1
    return left, top, right, bottom


def square(image):
    """Ставит предмет в центр квадрата с полями, возвращает кадр и признак обреза."""
    pixels = np.asarray(image.convert('RGB'), dtype=np.int16)
    left, top, right, bottom = box = object_box(pixels)
    colour = background_colour(pixels, box)
    usable = background_region(pixels, box, colour)
    touches = (left - usable[0] < EDGE_SLACK or top - usable[1] < EDGE_SLACK
               or usable[2] - right < EDGE_SLACK or usable[3] - bottom < EDGE_SLACK)

    side = int(round(max(right - left, bottom - top) / (1 - 2 * MARGIN)))
    start_x = int(round((left + right - side) / 2))
    start_y = int(round((top + bottom - side) / 2))
    taken = (max(start_x, usable[0]), max(start_y, usable[1]),
             min(start_x + side - 1, usable[2]), min(start_y + side - 1, usable[3]))

    canvas = np.empty((side, side, 3), dtype=np.int16)
    canvas[:] = colour
    canvas[taken[1] - start_y:taken[3] - start_y + 1,
           taken[0] - start_x:taken[2] - start_x + 1] = \
        pixels[taken[1]:taken[3] + 1, taken[0]:taken[2] + 1]
    return Image.fromarray(canvas.astype(np.uint8)), touches
