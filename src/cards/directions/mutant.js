/**
 * Направление «Мутант»: фон выращивается алгоритмами из шума, а не свёрстан.
 *
 * Единственное направление, где карточка каждый бросок другая по устройству, а не по
 * числам. Семейств десять, и живут они по файлу в `cards/growth`: изолинии, поток, мозаика,
 * кольца, клеточный автомат, плитки Труше, интерференция, рекурсивный раскол, пласты и
 * реакция-диффузия. Ни одно из них не рисует картинку, все выводят её из своего правила.
 *
 * Раздача семейств серийная, и это главное устройство направления. Серийный поток тасует
 * колоду один раз, карточка берёт из неё своё место по номеру артиста. Шесть афиш серии
 * получают шесть разных систем, а сид фона решает, кому какая досталась. Броска «каждая
 * карточка сама себе выбирает» здесь нет намеренно: на нём серия из шести карточек и двух
 * доступных алгоритмов складывалась в три и три одинаковых.
 *
 * В режиме сумасшествия карточка берёт из колоды подряд ещё один-два соседних семейства и
 * кладёт их поверх своего случайным способом наложения: difference поверх lighter поверх
 * screen даёт то, что заранее не увидеть.
 *
 * Случайность всё равно укрощена сидом: непредсказуемость здесь означает «не угадаешь до
 * броска», а не «не повторишь после». Один сид фона даёт один и тот же фон навсегда.
 *
 * Фон живёт на своём потоке (`bgRandom`): кнопка «Фон» переберает только его, не трогая
 * раскладку текста. Раскладка, как везде, приходит из `look`.
 */

import { growthOrder } from '../growth/index.js';
import { pxChain, pxDegrade, pxParams } from '../../px/paint.js';
import { createLayer } from '../layer.js';
import { logoLayer } from '../logo.js';
import {
  NARROW_FACE, capHeight, fillTracked, justifyLine, measureLine,
} from '../lettering.js';
import { grain, vignette } from '../wear.js';

// Сумасшествие делает две вещи разом: кладёт друг на друга несколько семейств и распускает
// ручки движка PX от ручного центра до полного разноса. Второе важнее первого: на разбросе
// в единицу источник перестаёт быть похожим сам на себя.
const MAD_SPREAD = 0.85;
const CALM_SPREAD = 0.12;
// Эффектор пускает фон через цепочку деструкторов движка: чем сильнее ползунок, тем длиннее
// цепочка и тем глубже каждое звено.
const WRECK_LINKS = [1, 3];
const MAD_LAYERS = [1, 3];
const MAD_OPS = [
  'lighter', 'difference', 'screen', 'exclusion', 'overlay', 'hard-light', 'multiply',
];
const MAD_INVERT_ODDS = 0.3;
// Слои берутся через колоду, а не подряд: соседние места часто отдают похожие по плотности
// системы, и три таких слоя сливаются в кашу вместо трёх разных почерков.
const MAD_STRIDE = 3;

const LOGO_HEIGHT_UNITS = 7;
const NAME_MAX_UNITS = 15;
const NAME_TRACKING = 0.04;
const MICRO_PIXELS_UNITS = 1.6;
const MICRO_TRACKING = 0.55;
const MICRO_LEAD_UNITS = 3.4;

const GRAIN = 0.035;
const VIGNETTE = 0.42;

function paletteOf(inks) {
  return [inks.ember, inks.moon, inks.bone, inks.blood, inks.trip, inks.flame];
}

/** Семейство растёт на своём холсте и вжимается в кадр выбранным способом наложения. */
function applyGrowth(ctx, frame, random, palette, growth, op, spread) {
  const layer = createLayer(frame.width, frame.height);
  growth.grow(layer.ctx, frame, random, palette, { spread });
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

async function paintBackground(ctx, frame, { bgRandom, bgSeries, number, inks, madness, wreck }) {
  const palette = paletteOf(inks);
  const spread = madness ? MAD_SPREAD : CALM_SPREAD;
  ctx.fillStyle = bgRandom.pick([inks.void, inks.iron, inks.trip]);
  ctx.fillRect(0, 0, frame.width, frame.height);

  const order = growthOrder(bgSeries);
  const mine = (step) => order[(number - 1 + step) % order.length];

  if (!madness) {
    applyGrowth(ctx, frame, bgRandom, palette, mine(0), 'source-over', spread);
  } else {
    const layers = bgRandom.int(MAD_LAYERS[0], MAD_LAYERS[1]);
    for (let layer = 0; layer < layers; layer += 1) {
      applyGrowth(
        ctx, frame, bgRandom, palette,
        mine(layer * MAD_STRIDE),
        layer === 0 ? 'source-over' : bgRandom.pick(MAD_OPS),
        spread,
      );
    }
    if (bgRandom() < MAD_INVERT_ODDS) {
      ctx.save();
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, frame.width, frame.height);
      ctx.restore();
    }
  }

  if (!wreck.on) return;
  // Рецепт цепочки серийный, глубина карточная: серия громится одним почерком, но каждая
  // афиша своей рукой.
  const links = Math.max(
    WRECK_LINKS[0],
    Math.round(WRECK_LINKS[0] + (WRECK_LINKS[1] - WRECK_LINKS[0]) * Math.min(1, wreck.power)),
  );
  await pxDegrade(ctx, {
    width: frame.width,
    height: frame.height,
    params: pxParams(bgRandom().toString(16).slice(2, 10), spread),
    chain: pxChain(bgSeries, { power: Math.min(1, wreck.power), links }),
  });
}

function centred(ctx, frame, text, { y, pixels, tracking, color }) {
  const line = { pixels, tracking, face: NARROW_FACE, color };
  const width = measureLine(ctx, text, line);
  fillTracked(ctx, text, { ...line, x: (frame.width - width) / 2, y });
}

export default {
  id: 'mutant',
  label: 'Мутант',
  async paint({
    ctx, frame, random, event, artist, logo, inks, look, type, textOnly, show,
    bgRandom, bgSeries, madness, wreck = { on: false, power: 1 },
  }) {
    if (!textOnly) {
      await paintBackground(ctx, frame, {
        bgRandom: bgRandom ?? random,
        bgSeries: bgSeries ?? random,
        number: Number(artist.number),
        inks,
        madness,
        wreck,
      });

      const mark = logoLayer(logo.wordmark, {
        width: (frame.unit * LOGO_HEIGHT_UNITS * look.logoScale * logo.wordmark.width)
          / logo.wordmark.height,
        color: inks.bone,
      });
      ctx.drawImage(mark, (frame.width - mark.width) / 2, frame.top);
    }

    if (show.name) {
      const name = justifyLine(ctx, artist.name, {
        width: frame.innerWidth,
        maxPixels: frame.unit * NAME_MAX_UNITS * look.nameScale,
        tracking: NAME_TRACKING,
        face: NARROW_FACE,
        scale: type.scale('name'),
      });
      const cap = capHeight(ctx, artist.name, { pixels: name.pixels, face: NARROW_FACE });
      const baseline = frame.height * look.nameCenter + cap / 2;
      ctx.save();
      ctx.translate(frame.width / 2, baseline);
      ctx.rotate(look.tilt);
      ctx.translate(-frame.width / 2, -baseline);
      fillTracked(ctx, artist.name, {
        // Двинутое пультом имя уже не выключено по краям полей и встаёт в середину колонки.
        x: frame.left + (frame.innerWidth - name.width) / 2,
        y: baseline,
        pixels: name.pixels,
        tracking: name.tracking,
        face: NARROW_FACE,
        color: type.ink('name', inks.flame),
      });
      ctx.restore();
    }

    if (show.meta) {
      centred(ctx, frame, `${artist.number} / ${event.dateLabel} / ${event.venue}`, {
        y: frame.bottom,
        pixels: frame.unit * MICRO_PIXELS_UNITS * type.scale('meta'),
        tracking: MICRO_TRACKING,
        color: type.ink('meta', inks.bone),
      });
    }
    if (show.credit && artist.credit) {
      centred(ctx, frame, artist.credit, {
        y: frame.bottom - frame.unit * MICRO_LEAD_UNITS,
        pixels: frame.unit * MICRO_PIXELS_UNITS * type.scale('credit'),
        tracking: MICRO_TRACKING,
        color: type.ink('credit', inks.ember),
      });
    }

    if (!textOnly) {
      vignette(ctx, frame, { hex: inks.void, amount: VIGNETTE });
      grain(ctx, frame, random, GRAIN);
    }
  },
};
