/**
 * Отрисовка одной карточки: холст, потоки случайности, направление и слои поверх.
 *
 * Случайность двухэтажная, и это главное устройство серии. Серийные потоки, по одному на
 * сид без подмеса номера, решают всё общее: макет компоновки, рецепт эффектора, стиль
 * рамки, набор сигилов. Карточные потоки, с подмесом номера, решают частное: куда упадёт
 * пересадка, какой знак встанет в гнездо, как дрогнет строка. Так серия остаётся серией
 * при любом сумасшествии: шесть карточек громятся одним почерком.
 *
 * Сидов у пульта пять: общий, компоновка, фактура, фон, объём. Каждый переброшивается
 * отдельно, поэтому удачное ловится и держится по частям.
 *
 * Текстовый слой прозрачный и уходит отдельным файлом. Плашка перештамповывает набор
 * поверх разгрома с тенью из его же формы; свечение кладёт под набор ореол жара.
 */

import { createRandom, seedToInt } from '../understav/random.js';
import { createFrame, FORMATS } from './format.js';
import { createLayer } from './layer.js';
import { makeInks } from './ink.js';
import { createLook } from './look.js';
import { applyTexture } from './texture.js';
import { drawDimension } from './dimension.js';
import { applyChaos, createChaosRecipe } from './chaos.js';
import { drawBorder } from './border.js';
import { drawSigils } from './sigils.js';
import { directionById } from './directions/index.js';
import { createTypeset, defaultText } from './typeset.js';

// Соль между карточками: без неё шесть афиш одного сида получают один и тот же поток и
// расходятся только текстом. Число простое и большое, чтобы соседние номера не пересекались.
const CARD_SALT = 0x9e3779b1;

// Свои соли у объёма, эффектора, фона и сигилов: иначе они читали бы один поток и
// переброс одного втихую переставлял бы остальные.
const DIMENSION_SALT = 101;
const CHAOS_SALT = 202;
const BACKGROUND_SALT = 303;
const SIGIL_SALT = 404;
const BORDER_SALT = 505;

// Плашка: размытие тени в юнитах и её плотность.
const PLAQUE_BLUR_UNITS = 1.3;
const PLAQUE_ALPHA = 0.85;

// Свечение: ореол набора в юнитах размытия и его сила одним проходом. Сила сдержанная
// намеренно: в текстовом слое живёт и номер-призрак, и на двойном проходе он раздувался
// в шар, съедавший карточку.
const GLOW_BLUR_UNITS = 1.8;
const GLOW_ALPHA = 0.3;

function cardSeed(seed, index) {
  return ((seedToInt(seed) + index * CARD_SALT) >>> 0).toString(16);
}

/** Серийный поток: сид с солью роли, но без номера карточки, один на всю серию. */
function seriesRandom(seed, salt) {
  return createRandom(((seedToInt(seed) + salt) >>> 0).toString(16));
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

/** Ореол жара из формы набора: размытый слой перекрашивается и вжимается сложением. */
function stampGlow(ctx, frame, textLayer, inks) {
  const halo = createLayer(frame.width, frame.height);
  halo.ctx.filter = `blur(${frame.unit * GLOW_BLUR_UNITS}px)`;
  halo.ctx.drawImage(textLayer, 0, 0);
  halo.ctx.filter = 'none';
  halo.ctx.globalCompositeOperation = 'source-in';
  halo.ctx.fillStyle = inks.ember;
  halo.ctx.fillRect(0, 0, frame.width, frame.height);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = GLOW_ALPHA;
  ctx.drawImage(halo.canvas, 0, 0);
  ctx.restore();
}

export function renderCard({
  event, artist, logo, direction, format, index,
  seed, laySeed, texSeed, bgSeed, objSeed, localSeed = null, hot, cold,
  allow3d, chaos, madness, plaque, glow, border = 'none', sigils,
  objTone = 'heat', objAlpha = 0.92, objBehind = false,
  chaosPower = 1, chaosZone = 'all',
  text = defaultText(), textOnly = false,
}) {
  const size = FORMATS[format];
  const { canvas, ctx } = createLayer(size.width, size.height);
  const frame = createFrame(size);
  const inks = makeInks({ hot, cold });
  const layBase = laySeed ?? seed;
  const texBase = texSeed ?? seed;
  const objBase = objSeed ?? texBase;
  // Локальный сид перекрывает карточные потоки, серийные не трогает: карточка
  // перерождается одна, но остаётся в макете, рецепте и рамке своей серии.
  const own = (base) => localSeed ?? base;
  const look = createLook(createRandom(layBase), createRandom(cardSeed(own(layBase), index)));
  const type = createTypeset(text);
  const show = type.show;

  const paintArgs = (target, asText, gates = show) => ({
    ctx: target,
    frame,
    random: createRandom(cardSeed(own(seed), index)),
    bgRandom: createRandom(cardSeed(own(bgSeed ?? seed), index + BACKGROUND_SALT)),
    // Серийный поток фона: он раздаёт мутанту генеративные семейства так, чтобы в серии
    // не встретились две карточки одного устройства.
    bgSeries: seriesRandom(bgSeed ?? seed, BACKGROUND_SALT),
    event,
    artist,
    logo,
    inks,
    look,
    type,
    madness,
    show: gates,
    textOnly: asText,
  });

  const anyText = show.name || show.meta || show.credit;
  // Раздельная сборка: текст уходит на свой слой, когда его надо защитить от 3D
  // (за текстом) или от эффектора (зона не «всё»). Иначе конвейер прежний, цельный.
  const split = !textOnly && anyText
    && ((allow3d && objBehind) || (chaos && chaosZone !== 'all'));

  directionById(direction).paint(paintArgs(
    ctx, textOnly, split ? { name: false, meta: false, credit: false } : show,
  ));

  if (!textOnly) {
    applyTexture(ctx, frame, createRandom(cardSeed(own(texBase), index)), inks);
    if (allow3d) {
      drawDimension(
        ctx, frame,
        createRandom(cardSeed(own(objBase), index + DIMENSION_SALT)),
        inks,
        { tone: objTone, alpha: objAlpha },
      );
    }
    if (sigils) {
      drawSigils(
        ctx,
        frame,
        seriesRandom(layBase, SIGIL_SALT),
        createRandom(cardSeed(own(layBase), index + SIGIL_SALT)),
        inks,
      );
    }
    const recipe = chaos ? createChaosRecipe(seriesRandom(texBase, CHAOS_SALT)) : null;
    const chaosRandom = () => createRandom(cardSeed(own(texBase), index + CHAOS_SALT));
    if (chaos && (!split || chaosZone === 'bg')) {
      applyChaos(ctx, frame, chaosRandom(), inks, recipe, chaosPower);
    }
    // Рамка после разгрома: оправа держит хаос внутри, как стекло витрины.
    drawBorder(
      ctx,
      frame,
      border,
      seriesRandom(layBase, BORDER_SALT),
      createRandom(cardSeed(own(layBase), index + BORDER_SALT)),
      inks,
    );
    if ((split || plaque || glow) && anyText) {
      const set = createLayer(frame.width, frame.height);
      directionById(direction).paint(paintArgs(set.ctx, true));
      // Зона «текст»: рецепт бьёт только по слою набора, фон остаётся целым.
      if (chaos && split && chaosZone === 'text') {
        applyChaos(set.ctx, frame, chaosRandom(), inks, recipe, chaosPower);
      }
      if (glow) stampGlow(ctx, frame, set.canvas, inks);
      if (plaque) {
        stampPlaque(ctx, frame, set.canvas, inks);
      } else if (split) {
        ctx.drawImage(set.canvas, 0, 0);
      }
    }
  }
  return canvas;
}
