/**
 * Источники PX·77 в виде семейств мутанта.
 *
 * У движка PX свой договор: сид даёт набор ручек, ручки рисуют кадр, ширину разброса ручек
 * задаёт `spread`. У наших семейств договор другой: поток случайности и палитра. Мост между
 * ними живёт здесь, поэтому ни один файл движка не тронут и ни одно наше семейство не знает
 * про существование ручек.
 *
 * Сид карточки приходит числом из потока: у семейства нет доступа к строке сида, а движку
 * нужна строка. Число из потока детерминировано тем же сидом, поэтому карточка остаётся
 * повторимой: один сид даёт тот же кадр навсегда.
 *
 * Палитра движка это два цвета, основной и горячий. Наши краски приходят списком, где жар
 * стоит первым, а луна второй: жар уходит в горячий, луна в основной. Так карточка PX
 * остаётся в цветах серии и не приносит своих оттенков.
 */

import { PX_SOURCES, pxParams, pxRender } from '../../px/paint.js';

const SEED_SPAN = 0xffffffff;

function seedString(random) {
  return Math.floor(random() * SEED_SPAN).toString(16).toUpperCase().padStart(8, '0');
}

export const PX_FAMILIES = PX_SOURCES.map((source) => ({
  id: `px-${source.id}`,
  label: source.label,
  desc: source.desc,
  grow(ctx, frame, random, palette, { spread = 0 } = {}) {
    pxRender(ctx, {
      width: frame.width,
      height: frame.height,
      source: source.id,
      params: pxParams(seedString(random), spread),
      palette: { main: palette[1], hot: palette[0] },
    });
  },
}));
