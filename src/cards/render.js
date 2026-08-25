/**
 * Отрисовка одной карточки: холст, три потока случайности, направление и слои поверх.
 *
 * Потока три, и это устройство пульта, а не украшение. Общий сид кормит направление
 * (износ, порча, поле), сид компоновки решает раскладку текста и знака, сид фактуры
 * держит блочную сыпь px-77, объём и эффектор. Каждый переброшивается отдельно, поэтому
 * можно ловить удачную раскладку, не теряя удачную фактуру.
 *
 * Фон карточка заливает всегда и во всю сторону: ни одно направление не оставляет
 * прозрачных полей. Исключение одно и намеренное: текстовый слой. Он рисует только набор
 * на прозрачном холсте и уходит отдельным файлом тому, кто будет двигать строки руками.
 */

import { createRandom, seedToInt } from '../understav/random.js';
import { createFrame, FORMATS } from './format.js';
import { createLayer } from './layer.js';
import { makeInks } from './ink.js';
import { createLook } from './look.js';
import { applyTexture } from './texture.js';
import { drawDimension } from './dimension.js';
import { applyChaos } from './chaos.js';
import { directionById } from './directions/index.js';

// Соль между карточками: без неё шесть афиш одного сида получают один и тот же поток и
// расходятся только текстом. Число простое и большое, чтобы соседние номера не пересекались.
const CARD_SALT = 0x9e3779b1;

// Свои соли у объёма и эффектора: иначе они читали бы тот же поток, что фактура, и
// переброс фактуры втихую переставлял бы и предмет.
const DIMENSION_SALT = 101;
const CHAOS_SALT = 202;

function cardSeed(seed, index) {
  return ((seedToInt(seed) + index * CARD_SALT) >>> 0).toString(16);
}

export function renderCard({
  event, artist, logo, direction, format, index,
  seed, laySeed, texSeed, hot, cold, allow3d, chaos, textOnly = false,
}) {
  const size = FORMATS[format];
  const { canvas, ctx } = createLayer(size.width, size.height);
  const frame = createFrame(size);
  const inks = makeInks({ hot, cold });
  const look = createLook(createRandom(cardSeed(laySeed ?? seed, index)));

  directionById(direction).paint({
    ctx,
    frame,
    random: createRandom(cardSeed(seed, index)),
    event,
    artist,
    logo,
    inks,
    look,
    textOnly,
  });

  if (!textOnly) {
    const texBase = texSeed ?? seed;
    applyTexture(ctx, frame, createRandom(cardSeed(texBase, index)), inks);
    if (allow3d) {
      drawDimension(ctx, frame, createRandom(cardSeed(texBase, index + DIMENSION_SALT)), inks);
    }
    if (chaos) {
      applyChaos(ctx, frame, createRandom(cardSeed(texBase, index + CHAOS_SALT)), inks);
    }
  }
  return canvas;
}
