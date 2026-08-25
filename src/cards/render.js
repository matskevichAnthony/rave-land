/**
 * Отрисовка одной карточки: холст, поток случайности, направление.
 *
 * Фон карточка заливает всегда и во всю сторону — ни одно направление не оставляет
 * прозрачных полей. Это не аккуратность ради аккуратности: тот же файл уходит текстурой на
 * стену коридора, а прозрачный край там читается дырой в бетоне.
 */

import { createRandom, seedToInt } from '../understav/random.js';
import { createFrame, FORMATS } from './format.js';
import { createLayer } from './layer.js';
import { directionById } from './directions/index.js';

// Соль между карточками: без неё шесть афиш одного сида получают один и тот же поток и
// расходятся только текстом. Число простое и большое, чтобы соседние номера не пересекались.
const CARD_SALT = 0x9e3779b1;

export function cardSeed(seed, index) {
  return ((seedToInt(seed) + index * CARD_SALT) >>> 0).toString(16);
}

export function renderCard({ event, artist, logo, direction, format, seed, index }) {
  const size = FORMATS[format];
  const { canvas, ctx } = createLayer(size.width, size.height);
  directionById(direction).paint({
    ctx,
    frame: createFrame(size),
    random: createRandom(cardSeed(seed, index)),
    event,
    artist,
    logo,
  });
  return canvas;
}
