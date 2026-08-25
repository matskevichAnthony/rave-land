/**
 * Направление «Трафарет»: плоская афиша печатного цеха.
 *
 * Никакой глубины и никакого света: только чёрное поле, колонки разметки и имя, прорезанное
 * трафаретом во всю ширину. Это самый жёсткий вариант серии и единственный, который читается
 * с ногтя в ленте без всяких оговорок: имя держит около половины высоты и стоит по краям полей.
 *
 * Раскладка приходит из `look`: центр имени, кегль, масштаб номера и знака решает сид
 * компоновки, а не константы файла. Краски приходят из `inks`: два глобальных цвета пульта
 * перекрашивают карточку, не трогая её устройство.
 */

import { rgba } from '../ink.js';
import { logoLayer } from '../logo.js';
import { blockRail } from '../glitch.js';
import {
  NARROW_FACE, capHeight, fillTracked, gothicFaceFor, justifyLine, measureLine, stencilLine,
} from '../lettering.js';
import { grain, vignette } from '../wear.js';

const COLUMNS = 6;
const COLUMN_ALPHA = 0.5;
const CROSS_ALPHA = 0.85;

const LOGO_HEIGHT_UNITS = 19;
const MICRO_PIXELS_UNITS = 1.6;
const MICRO_TRACKING = 0.55;
const MICRO_LEAD_UNITS = 3.2;

// Порядковый номер стоит призраком во всю карточку: в ленте шесть афиш идут подряд, и номер
// читается счётчиком серии раньше, чем зритель разберёт имя.
const NUMBER_HEIGHT_RATIO = 0.72;
const NUMBER_BASELINE_RATIO = 0.86;

const NAME_MAX_UNITS = 17;
const NAME_TRACKING = 0.04;
const RULE_THICKNESS_UNITS = 0.5;
const RULE_GAP_UNITS = 3;

const RAIL_LENGTH = 34;
const RAIL_PIXELS_UNITS = 2.2;
const RAIL_TRACKING = 0.06;

// Тэглайн набран той же вязью, что заголовок сцены: в подвале карточки он читается
// подписью ритуала, а не ещё одной служебной строкой гротеска.
const TAGLINE_PIXELS_UNITS = 2.6;
const TAGLINE_TRACKING = 0.04;

const GRAIN = 0.035;
const VIGNETTE = 0.55;

function paintColumns(ctx, frame, inks) {
  ctx.fillStyle = rgba(inks.concrete, COLUMN_ALPHA);
  const step = frame.innerWidth / COLUMNS;
  for (let column = 0; column <= COLUMNS; column += 1) {
    ctx.fillRect(frame.left + column * step, frame.top, 1, frame.innerHeight);
  }
}

function paintNumber(ctx, frame, number, inks, look) {
  const pixels = frame.height * NUMBER_HEIGHT_RATIO * look.numberScale;
  const width = measureLine(ctx, number, { pixels, tracking: 0, face: NARROW_FACE });
  fillTracked(ctx, number, {
    x: (frame.width - width) / 2 + frame.width * look.drift,
    y: frame.height * (NUMBER_BASELINE_RATIO + look.numberDrift),
    pixels,
    tracking: 0,
    face: NARROW_FACE,
    color: inks.iron,
  });
}

function microLine(ctx, text, { x, y, frame, color }) {
  return fillTracked(ctx, text, {
    x,
    y,
    pixels: frame.unit * MICRO_PIXELS_UNITS,
    tracking: MICRO_TRACKING,
    face: NARROW_FACE,
    color,
  });
}

export default {
  id: 'stencil',
  label: 'Трафарет',
  paint({ ctx, frame, random, event, artist, logo, inks, look, textOnly }) {
    if (!textOnly) {
      ctx.fillStyle = inks.void;
      ctx.fillRect(0, 0, frame.width, frame.height);
      paintColumns(ctx, frame, inks);

      const crosses = logoLayer(logo.crosses, { width: frame.width, color: inks.rust });
      ctx.save();
      ctx.globalAlpha = CROSS_ALPHA;
      ctx.drawImage(crosses, 0, (frame.height - crosses.height) / 2);
      ctx.restore();
    }

    paintNumber(ctx, frame, artist.number, inks, look);

    const logoUnits = LOGO_HEIGHT_UNITS * look.logoScale;
    const mark = logoLayer(logo.wordmark, {
      width: (frame.unit * logoUnits * logo.wordmark.width) / logo.wordmark.height,
      color: inks.bone,
    });
    const markX = look.logoRight ? frame.right - mark.width : frame.left;
    if (!textOnly) ctx.drawImage(mark, markX, frame.top);

    const headTop = frame.top + frame.unit * MICRO_LEAD_UNITS;
    const headX = look.logoRight ? frame.left : frame.left + mark.width + frame.unit * 2;
    microLine(ctx, event.dateLabel, { x: headX, y: headTop, frame, color: inks.ember });
    microLine(ctx, event.venue, { x: headX, y: headTop + frame.unit * MICRO_LEAD_UNITS, frame, color: inks.bone });

    const name = justifyLine(ctx, artist.name, {
      width: frame.innerWidth,
      maxPixels: frame.unit * NAME_MAX_UNITS * look.nameScale,
      tracking: NAME_TRACKING,
      face: NARROW_FACE,
    });
    const cap = capHeight(ctx, artist.name, { pixels: name.pixels, face: NARROW_FACE });
    const baseline = frame.height * look.nameCenter + cap / 2;

    ctx.save();
    ctx.translate(frame.width / 2, baseline);
    ctx.rotate(look.tilt);
    ctx.translate(-frame.width / 2, -baseline);
    stencilLine(ctx, artist.name, {
      x: frame.left,
      y: baseline,
      pixels: name.pixels,
      tracking: name.tracking,
      face: NARROW_FACE,
      color: inks.ember,
    });
    ctx.restore();

    const ruleY = baseline + frame.unit * RULE_GAP_UNITS;
    if (!textOnly) {
      ctx.fillStyle = inks.ember;
      ctx.fillRect(frame.left, ruleY, frame.innerWidth, frame.unit * RULE_THICKNESS_UNITS);
    }

    const under = ruleY + frame.unit * (RULE_THICKNESS_UNITS + MICRO_LEAD_UNITS);
    microLine(ctx, artist.credit, { x: frame.left, y: under, frame, color: inks.bone });
    const setWidth = measureLine(ctx, artist.set, {
      pixels: frame.unit * MICRO_PIXELS_UNITS,
      tracking: MICRO_TRACKING,
      face: NARROW_FACE,
    });
    microLine(ctx, artist.set, { x: frame.right - setWidth, y: under, frame, color: inks.ember });

    fillTracked(ctx, blockRail(random, RAIL_LENGTH), {
      x: frame.left,
      y: frame.bottom - frame.unit * MICRO_LEAD_UNITS,
      pixels: frame.unit * RAIL_PIXELS_UNITS,
      tracking: RAIL_TRACKING,
      face: NARROW_FACE,
      color: inks.rust,
    });
    fillTracked(ctx, event.tagline, {
      x: frame.left,
      y: frame.bottom,
      pixels: frame.unit * TAGLINE_PIXELS_UNITS,
      tracking: TAGLINE_TRACKING,
      face: gothicFaceFor(event.tagline),
      color: inks.bone,
    });

    if (!textOnly) {
      vignette(ctx, frame, { hex: inks.void, amount: VIGNETTE });
      grain(ctx, frame, random, GRAIN);
    }
  },
};
