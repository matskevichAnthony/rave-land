/**
 * Отрисовка одной карточки: холст, четыре потока случайности, направление и слои поверх.
 *
 * Потоков четыре, и это устройство пульта, а не украшение. Общий сид кормит направление
 * (износ, порча, поле), сид компоновки решает раскладку текста и знака, сид фактуры
 * держит блочную сыпь px-77, объём и эффектор, сид фона переберает генеративный фон
 * мутанта, не трогая остального. Каждый переброшивается отдельно, поэтому можно ловить
 * удачную раскладку, не теряя удачную фактуру или удачный фон.
 *
 * Фон карточка заливает всегда и во всю сторону: ни одно направление не оставляет
 * прозрачных полей. Исключение одно и намеренное: текстовый слой. Он рисует только набор
 * на прозрачном холсте и уходит отдельным файлом тому, кто будет двигать строки руками.
 *
 * Плашка решает вечный спор эффектов с текстом: после всего разгрома набор перештамповывается
 * поверх со своей тёмной тенью, выращенной из его же формы. Тень шире букв на размытие,
 * поэтому она читается подложкой, а не обводкой.
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

// Свои соли у объёма, эффектора и фона: иначе они читали бы тот же поток, что фактура, и
// переброс фактуры втихую переставлял бы и предмет, и фон.
const DIMENSION_SALT = 101;
const CHAOS_SALT = 202;
const BACKGROUND_SALT = 303;

// Плашка: размытие тени в юнитах и её плотность.
const PLAQUE_BLUR_UNITS = 1.3;
const PLAQUE_ALPHA = 0.85;

function cardSeed(seed, index) {
  return ((seedToInt(seed) + index * CARD_SALT) >>> 0).toString(16);
}

/**
 * Тень набора из его собственной формы: текстовый слой размывается, перекрашивается в
 * чёрный через source-in и ложится под чистый оттиск. Работает с любым направлением,
 * потому что не знает, где стоят строки: форму приносит сам слой.
 */
function stampPlaque(ctx, frame, textLayer, inks) {
  const shadow = createLayer(frame.width, frame.height);
  shadow.ctx.filter = `blur(${frame.unit * PLAQUE_BLUR_UNITS}px)`;
  shadow.ctx.drawImage(textLayer, 0, 0);
  shadow.ctx.drawImage(textLayer, 0, 0);
  shadow.ctx.filter = 'none';
  shadow.ctx.globalCompositeOperation = 'source-in';
  shadow.ctx.fillStyle = inks.void;
  shadow.ctx.fillRect(0, 0, frame.width, frame.height);

  ctx.save();
  ctx.globalAlpha = PLAQUE_ALPHA;
  ctx.drawImage(shadow.canvas, 0, 0);
  ctx.restore();
  ctx.drawImage(textLayer, 0, 0);
}

export function renderCard({
  event, artist, logo, direction, format, index,
  seed, laySeed, texSeed, bgSeed, hot, cold, allow3d, chaos, madness, plaque,
  showName = true, showMeta = true, showCredit = true, textOnly = false,
}) {
  const size = FORMATS[format];
  const { canvas, ctx } = createLayer(size.width, size.height);
  const frame = createFrame(size);
  const inks = makeInks({ hot, cold });
  const look = createLook(createRandom(cardSeed(laySeed ?? seed, index)));
  const show = { name: showName, meta: showMeta, credit: showCredit };
  const texBase = texSeed ?? seed;

  const paintArgs = (target, asText) => ({
    ctx: target,
    frame,
    random: createRandom(cardSeed(seed, index)),
    bgRandom: createRandom(cardSeed(bgSeed ?? seed, index + BACKGROUND_SALT)),
    event,
    artist,
    logo,
    inks,
    look,
    madness,
    show,
    textOnly: asText,
  });

  directionById(direction).paint(paintArgs(ctx, textOnly));

  if (!textOnly) {
    applyTexture(ctx, frame, createRandom(cardSeed(texBase, index)), inks);
    if (allow3d) {
      drawDimension(ctx, frame, createRandom(cardSeed(texBase, index + DIMENSION_SALT)), inks);
    }
    if (chaos) {
      applyChaos(ctx, frame, createRandom(cardSeed(texBase, index + CHAOS_SALT)), inks);
    }
    // Плашка идёт последней: она возвращает набор поверх всего, что его закопало.
    if (plaque && (show.name || show.meta || show.credit)) {
      const text = createLayer(frame.width, frame.height);
      directionById(direction).paint(paintArgs(text.ctx, true));
      stampPlaque(ctx, frame, text.canvas, inks);
    }
  }
  return canvas;
}
