/**
 * Направление «Датамош»: кадр, разъеденный сдвигом блоков и разъездом каналов.
 *
 * Приём тот же, что у сцены в `understav/effects.js`: изображение режется на полосы, полосы
 * разъезжаются, красный и синий расходятся в стороны. Разница в том, что имя не портится
 * вовсе: оно ложится поверх уже развалившегося кадра чистым и остаётся единственным, что
 * в карточке стоит на месте. Испорченное имя красиво ровно один раз и нечитаемо всегда.
 *
 * Раскладку решает `look`, краски решает `inks`: сид компоновки двигает имя и знак, два
 * глобальных цвета пульта перекрашивают жар и холод разъезда.
 */

import { between } from '../../procedural/random.js';
import { rgba, verticalFade } from '../ink.js';
import { logoLayer } from '../logo.js';
import { corrupt } from '../glitch.js';
import { createLayer } from '../layer.js';
import {
  NARROW_FACE, capHeight, fillTracked, justifyLine, measureLine,
} from '../lettering.js';
import { chromatic, grain, vignette } from '../wear.js';

const SCAN_BANDS = 46;
const SCAN_ALPHA = [0.15, 0.55];

const LOGO_WIDTH_RATIO = 1.24;
const LOGO_CENTER_RATIO = 0.42;
// Знак лежит тенью, а не краской: в полную силу ржавчина занимает всю карточку и имя
// садится на оранжевое поле, где ему нечем светиться.
const LOGO_ALPHA = 0.55;

const NOISE_LINES = 11;
const NOISE_PIXELS_UNITS = 3.2;
const NOISE_TRACKING = 0.12;
const NOISE_AMOUNT = 1;
const NOISE_ALPHA = 0.32;
const NOISE_DRIFT_UNITS = 9;

const MOSH_BANDS = 26;
const MOSH_SPREAD = [0.4, 2.2];
const MOSH_AMPLITUDE_UNITS = 5;
const MOSH_ODDS = 0.55;

const NAME_MAX_UNITS = 16;
const NAME_TRACKING = 0.03;
// Двоение имени это разъезд каналов, а не подсветка: жар уходит влево, холод вправо.
const GHOST_OFFSET_UNITS = 1.2;
const GHOST_ALPHA = 0.45;

const MICRO_PIXELS_UNITS = 1.6;
const MICRO_TRACKING = 0.55;
const MICRO_LEAD_UNITS = 3.4;
const SLAB_PAD_UNITS = 1.4;

// Подвал лежит на самом мусоре, и мелкая строка в нём тонет. Затемнение внизу возвращает
// дате и площадке фон, не отменяя разрушения выше.
const SCRIM_RATIO = 0.24;

const CHROMA_OFFSET_UNITS = 0.55;
const CHROMA_STRENGTH = 0.92;
const GRAIN = 0.05;
const VIGNETTE = 0.6;

function paintScan(ctx, frame, random, inks) {
  const step = frame.height / SCAN_BANDS;
  for (let band = 0; band < SCAN_BANDS; band += 1) {
    ctx.fillStyle = rgba(band % 2 ? inks.iron : inks.concrete, between(random, SCAN_ALPHA[0], SCAN_ALPHA[1]));
    ctx.fillRect(0, band * step, frame.width, step);
  }
}

/** Полосы уезжают в стороны, но по вертикали покрывают карточку встык: дыр не остаётся. */
function moshOnto(ctx, source, frame, random) {
  const amplitude = frame.unit * MOSH_AMPLITUDE_UNITS;
  const step = frame.height / MOSH_BANDS;
  let top = 0;
  while (top < frame.height) {
    const height = Math.min(step * between(random, MOSH_SPREAD[0], MOSH_SPREAD[1]), frame.height - top);
    const shift = random() < MOSH_ODDS ? between(random, -amplitude, amplitude) : 0;
    ctx.drawImage(source, 0, top, frame.width, height, shift, top, frame.width, height);
    top += height;
  }
}

function paintNoise(ctx, frame, random, name, inks) {
  const pixels = frame.unit * NOISE_PIXELS_UNITS;
  const lead = frame.innerHeight / NOISE_LINES;
  ctx.globalAlpha = NOISE_ALPHA;
  for (let line = 0; line < NOISE_LINES; line += 1) {
    fillTracked(ctx, corrupt(name, random, NOISE_AMOUNT), {
      x: frame.left - frame.unit * between(random, 0, NOISE_DRIFT_UNITS),
      y: frame.top + lead * (line + 1),
      pixels,
      tracking: NOISE_TRACKING,
      face: NARROW_FACE,
      color: inks.moon,
    });
  }
  ctx.globalAlpha = 1;
}

function microSlab(ctx, frame, text, { x, y, ink, slab, textOnly }) {
  const pixels = frame.unit * MICRO_PIXELS_UNITS;
  const width = measureLine(ctx, text, { pixels, tracking: MICRO_TRACKING, face: NARROW_FACE });
  const pad = frame.unit * SLAB_PAD_UNITS;
  if (!textOnly) {
    ctx.fillStyle = slab;
    ctx.fillRect(x - pad, y - pixels, width + pad * 2, pixels + pad);
  }
  fillTracked(ctx, text, { x, y, pixels, tracking: MICRO_TRACKING, face: NARROW_FACE, color: ink });
  return width + pad * 2;
}

export default {
  id: 'datamosh',
  label: 'Датамош',
  paint({ ctx, frame, random, event, artist, logo, inks, look, textOnly }) {
    if (!textOnly) {
      ctx.fillStyle = inks.void;
      ctx.fillRect(0, 0, frame.width, frame.height);
      paintScan(ctx, frame, random, inks);

      const layer = createLayer(frame.width, frame.height);
      const mark = logoLayer(logo.wordmark, {
        width: frame.width * LOGO_WIDTH_RATIO * look.logoScale,
        color: inks.rust,
      });
      layer.ctx.globalAlpha = LOGO_ALPHA;
      layer.ctx.drawImage(
        mark,
        (frame.width - mark.width) / 2 + frame.width * look.drift,
        frame.height * LOGO_CENTER_RATIO - mark.height / 2,
      );
      layer.ctx.globalAlpha = 1;
      paintNoise(layer.ctx, frame, random, artist.name, inks);
      moshOnto(ctx, layer.canvas, frame, random);
    }

    const name = justifyLine(ctx, artist.name, {
      width: frame.innerWidth,
      maxPixels: frame.unit * NAME_MAX_UNITS * look.nameScale,
      tracking: NAME_TRACKING,
      face: NARROW_FACE,
    });
    const cap = capHeight(ctx, artist.name, { pixels: name.pixels, face: NARROW_FACE });
    const baseline = frame.height * look.nameCenter + cap / 2;
    const line = {
      x: frame.left,
      y: baseline,
      pixels: name.pixels,
      tracking: name.tracking,
      face: NARROW_FACE,
    };

    ctx.save();
    ctx.translate(frame.width / 2, baseline);
    ctx.rotate(look.tilt);
    ctx.translate(-frame.width / 2, -baseline);
    if (!textOnly) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = GHOST_ALPHA;
      fillTracked(ctx, artist.name, { ...line, x: line.x - frame.unit * GHOST_OFFSET_UNITS, color: inks.blood });
      fillTracked(ctx, artist.name, { ...line, x: line.x + frame.unit * GHOST_OFFSET_UNITS, color: inks.moon });
      ctx.restore();
    }
    fillTracked(ctx, artist.name, { ...line, color: inks.flame });
    ctx.restore();

    if (!textOnly) {
      // Разъезд каналов ложится до служебных строк, а не после: он рвёт картинку, но время
      // сета и дату он бы просто раздвоил, а их читают с ногтя в ленте.
      chromatic(ctx, frame, {
        offset: frame.unit * CHROMA_OFFSET_UNITS,
        strength: CHROMA_STRENGTH,
      });

      const scrimTop = frame.height * (1 - SCRIM_RATIO);
      ctx.fillStyle = verticalFade(ctx, scrimTop, frame.height, [
        [0, inks.void, 0],
        [1, inks.void, 0.95],
      ]);
      ctx.fillRect(0, scrimTop, frame.width, frame.height - scrimTop);
    }

    const head = frame.top + frame.unit * MICRO_LEAD_UNITS;
    microSlab(ctx, frame, artist.number, { x: frame.left, y: head, ink: inks.flame, slab: inks.blood, textOnly });
    microSlab(ctx, frame, event.dateLabel, {
      x: frame.left,
      y: baseline + frame.unit * MICRO_LEAD_UNITS * 2,
      // На прозрачном текстовом слое чёрная строка теряется, там она идёт жаром.
      ink: textOnly ? inks.ember : inks.void,
      slab: inks.ember,
      textOnly,
    });
    fillTracked(ctx, artist.credit, {
      x: frame.left,
      y: frame.bottom - frame.unit * MICRO_LEAD_UNITS,
      pixels: frame.unit * MICRO_PIXELS_UNITS,
      tracking: MICRO_TRACKING,
      face: NARROW_FACE,
      color: inks.bone,
    });
    fillTracked(ctx, `${event.venue} · ${artist.set}`, {
      x: frame.left,
      y: frame.bottom,
      pixels: frame.unit * MICRO_PIXELS_UNITS,
      tracking: MICRO_TRACKING,
      face: NARROW_FACE,
      color: inks.moon,
    });

    if (!textOnly) {
      vignette(ctx, frame, { hex: inks.void, amount: VIGNETTE });
      grain(ctx, frame, random, GRAIN);
    }
  },
};
