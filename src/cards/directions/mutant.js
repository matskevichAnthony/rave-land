/**
 * Направление «Мутант»: фон выращивается алгоритмами из шума, а не свёрстан.
 *
 * Единственное направление, где карточка каждый бросок другая по устройству, а не по
 * числам. Четыре алгоритма (изолинии, поток, мозаика, кольца) берут поле симплекс-шума и
 * рисуют его каждый по-своему. В спокойном режиме работает один алгоритм чистым наложением.
 * В режиме сумасшествия слоёв от одного до трёх, каждый со своим случайным способом
 * наложения: difference поверх lighter поверх screen даёт то, что заранее не увидеть.
 *
 * Случайность всё равно укрощена сидом: непредсказуемость здесь означает «не угадаешь до
 * броска», а не «не повторишь после». Один сид фона даёт один и тот же фон навсегда.
 *
 * Фон живёт на своём потоке (`bgRandom`): кнопка «Фон» переберает только его, не трогая
 * раскладку текста. Раскладка, как везде, приходит из `look`.
 */

import { createNoise2D } from 'simplex-noise';
import { rgba } from '../ink.js';
import { createLayer } from '../layer.js';
import { logoLayer } from '../logo.js';
import {
  NARROW_FACE, capHeight, fillTracked, justifyLine, measureLine,
} from '../lettering.js';
import { grain, vignette } from '../wear.js';

// Изолинии: плотность сетки в юнитах, число уровней и толщина пера.
const CONTOUR_CELL_UNITS = [1.1, 2.4];
const CONTOUR_FREQ = [1.6, 4.6];
const CONTOUR_LEVELS = [7, 16];
const CONTOUR_WIDTH_UNITS = [0.12, 0.45];
const CONTOUR_ALPHA = [0.3, 0.9];
const FIELD_SPAN = 1.8;

// Поток: частицы идут по полю углов и оставляют след.
const FLOW_COUNT = [150, 430];
const FLOW_STEPS = [30, 130];
const FLOW_STEP_UNITS = [0.5, 1.5];
const FLOW_CURL = [1.4, 4.2];
const FLOW_WIDTH_UNITS = [0.1, 0.5];
const FLOW_ALPHA = [0.1, 0.45];

// Мозаика: крупные ячейки в духе px-77, часть рядов уезжает.
const BLOCK_COLS = [9, 26];
const BLOCK_DENSITY = [0.2, 0.65];
const BLOCK_ALPHA = [0.4, 1];
const BLOCK_SHIFT_ODDS = 0.35;

// Кольца: замкнутые контуры вокруг сорванного центра.
const RING_COUNT = [9, 24];
const RING_SEGMENTS = 90;
const RING_WOBBLE_UNITS = [1.5, 7];
const RING_WIDTH_UNITS = [0.12, 0.5];
const RING_ALPHA = [0.25, 0.8];

// Сумасшествие: сколько слоёв и какие способы наложения разрешены.
const MAD_LAYERS = [1, 3];
const MAD_OPS = [
  'lighter', 'difference', 'screen', 'exclusion', 'overlay', 'hard-light', 'multiply',
];
const MAD_INVERT_ODDS = 0.3;

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

/** Интерполяция пересечения изолинии с ребром клетки. */
function cross(a, b, iso) {
  const gap = b - a;
  return gap === 0 ? 0.5 : (iso - a) / gap;
}

/**
 * Изолинии: marching squares по полю шума, как горизонтали на карте рельефа.
 * Каждый уровень идёт своим цветом из палитры, и поле читается топографией.
 */
function contour(ctx, frame, random, palette) {
  const noise = createNoise2D(random);
  const cell = Math.max(5, frame.unit * random.range(CONTOUR_CELL_UNITS[0], CONTOUR_CELL_UNITS[1]));
  const cols = Math.ceil(frame.width / cell) + 1;
  const rows = Math.ceil(frame.height / cell) + 1;
  const freq = random.range(CONTOUR_FREQ[0], CONTOUR_FREQ[1]) / Math.max(cols, rows);

  const field = [];
  for (let row = 0; row < rows; row += 1) {
    field[row] = [];
    for (let col = 0; col < cols; col += 1) {
      field[row][col] = noise(col * cell * freq, row * cell * freq);
    }
  }

  const levels = random.int(CONTOUR_LEVELS[0], CONTOUR_LEVELS[1]);
  ctx.lineWidth = Math.max(1, frame.unit * random.range(CONTOUR_WIDTH_UNITS[0], CONTOUR_WIDTH_UNITS[1]));
  for (let level = 0; level < levels; level += 1) {
    const iso = -FIELD_SPAN / 2 + (FIELD_SPAN * level) / (levels - 1);
    ctx.strokeStyle = rgba(palette[level % palette.length], random.range(CONTOUR_ALPHA[0], CONTOUR_ALPHA[1]));
    ctx.beginPath();
    for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < cols - 1; col += 1) {
        const tl = field[row][col];
        const tr = field[row][col + 1];
        const br = field[row + 1][col + 1];
        const bl = field[row + 1][col];
        const x = col * cell;
        const y = row * cell;
        const points = [];
        if ((tl < iso) !== (tr < iso)) points.push([x + cell * cross(tl, tr, iso), y]);
        if ((tr < iso) !== (br < iso)) points.push([x + cell, y + cell * cross(tr, br, iso)]);
        if ((bl < iso) !== (br < iso)) points.push([x + cell * cross(bl, br, iso), y + cell]);
        if ((tl < iso) !== (bl < iso)) points.push([x, y + cell * cross(tl, bl, iso)]);
        if (points.length >= 2) {
          ctx.moveTo(points[0][0], points[0][1]);
          ctx.lineTo(points[1][0], points[1][1]);
          if (points.length === 4) {
            ctx.moveTo(points[2][0], points[2][1]);
            ctx.lineTo(points[3][0], points[3][1]);
          }
        }
      }
    }
    ctx.stroke();
  }
}

/** Поток: частицы текут по полю углов, след остаётся волокнами. */
function flow(ctx, frame, random, palette) {
  const noise = createNoise2D(random);
  const freq = random.range(FLOW_CURL[0], FLOW_CURL[1]) / Math.min(frame.width, frame.height);
  const curl = random.range(FLOW_CURL[0], FLOW_CURL[1]);
  const count = random.int(FLOW_COUNT[0], FLOW_COUNT[1]);
  const steps = random.int(FLOW_STEPS[0], FLOW_STEPS[1]);
  const stride = frame.unit * random.range(FLOW_STEP_UNITS[0], FLOW_STEP_UNITS[1]);

  ctx.lineCap = 'round';
  for (let particle = 0; particle < count; particle += 1) {
    let x = random.range(0, frame.width);
    let y = random.range(0, frame.height);
    ctx.strokeStyle = rgba(random.pick(palette), random.range(FLOW_ALPHA[0], FLOW_ALPHA[1]));
    ctx.lineWidth = Math.max(1, frame.unit * random.range(FLOW_WIDTH_UNITS[0], FLOW_WIDTH_UNITS[1]));
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let step = 0; step < steps; step += 1) {
      const angle = noise(x * freq, y * freq) * Math.PI * curl;
      x += Math.cos(angle) * stride;
      y += Math.sin(angle) * stride;
      if (x < 0 || y < 0 || x > frame.width || y > frame.height) break;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Мозаика: крупная сыпь цветных ячеек, часть рядов уезжает вбок. */
function blocks(ctx, frame, random, palette) {
  const cols = random.int(BLOCK_COLS[0], BLOCK_COLS[1]);
  const cell = frame.width / cols;
  const rows = Math.ceil(frame.height / cell);
  const density = random.range(BLOCK_DENSITY[0], BLOCK_DENSITY[1]);
  for (let row = 0; row < rows; row += 1) {
    const shift = random() < BLOCK_SHIFT_ODDS ? random.range(-cell, cell) : 0;
    for (let col = -1; col <= cols; col += 1) {
      if (random() > density) continue;
      ctx.fillStyle = rgba(random.pick(palette), random.range(BLOCK_ALPHA[0], BLOCK_ALPHA[1]));
      ctx.fillRect(col * cell + shift, row * cell, cell * random.range(0.4, 1), cell * random.range(0.4, 1));
    }
  }
}

/** Кольца: контуры вокруг сорванного центра, радиус дышит шумом по углу. */
function rings(ctx, frame, random, palette) {
  const noise = createNoise2D(random);
  const centreX = frame.width * random.range(0.22, 0.78);
  const centreY = frame.height * random.range(0.22, 0.78);
  const count = random.int(RING_COUNT[0], RING_COUNT[1]);
  const reach = Math.hypot(frame.width, frame.height) * 0.62;
  const wobble = frame.unit * random.range(RING_WOBBLE_UNITS[0], RING_WOBBLE_UNITS[1]);
  const twist = random.range(0.6, 2.4);

  for (let ring = 1; ring <= count; ring += 1) {
    const base = (reach * ring) / count;
    ctx.strokeStyle = rgba(palette[ring % palette.length], random.range(RING_ALPHA[0], RING_ALPHA[1]));
    ctx.lineWidth = Math.max(1, frame.unit * random.range(RING_WIDTH_UNITS[0], RING_WIDTH_UNITS[1]));
    ctx.beginPath();
    for (let segment = 0; segment <= RING_SEGMENTS; segment += 1) {
      const angle = (Math.PI * 2 * segment) / RING_SEGMENTS;
      const radius = base + noise(Math.cos(angle) * twist, Math.sin(angle) * twist + ring) * wobble;
      const x = centreX + Math.cos(angle) * radius;
      const y = centreY + Math.sin(angle) * radius;
      if (segment === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

const ALGORITHMS = { contour, flow, blocks, rings };
const CALM_POOL = ['contour', 'flow'];
const MAD_POOL = Object.keys(ALGORITHMS);

/** Слой алгоритма рисуется на своём холсте и вжимается выбранным способом наложения. */
function applyAlgorithm(ctx, frame, random, palette, name, op) {
  const layer = createLayer(frame.width, frame.height);
  ALGORITHMS[name](layer.ctx, frame, random, palette);
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}

function paintBackground(ctx, frame, bgRandom, inks, madness) {
  const palette = paletteOf(inks);
  ctx.fillStyle = bgRandom.pick([inks.void, inks.iron, inks.trip]);
  ctx.fillRect(0, 0, frame.width, frame.height);

  if (!madness) {
    applyAlgorithm(ctx, frame, bgRandom, palette, bgRandom.pick(CALM_POOL), 'source-over');
    return;
  }

  const layers = bgRandom.int(MAD_LAYERS[0], MAD_LAYERS[1]);
  for (let layer = 0; layer < layers; layer += 1) {
    applyAlgorithm(
      ctx, frame, bgRandom, palette,
      bgRandom.pick(MAD_POOL),
      layer === 0 ? 'source-over' : bgRandom.pick(MAD_OPS),
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

function centred(ctx, frame, text, { y, pixels, tracking, color }) {
  const line = { pixels, tracking, face: NARROW_FACE, color };
  const width = measureLine(ctx, text, line);
  fillTracked(ctx, text, { ...line, x: (frame.width - width) / 2, y });
}

export default {
  id: 'mutant',
  label: 'Мутант',
  paint({ ctx, frame, random, event, artist, logo, inks, look, textOnly, show, bgRandom, madness }) {
    if (!textOnly) {
      paintBackground(ctx, frame, bgRandom ?? random, inks, madness);

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
      });
      const cap = capHeight(ctx, artist.name, { pixels: name.pixels, face: NARROW_FACE });
      const baseline = frame.height * look.nameCenter + cap / 2;
      ctx.save();
      ctx.translate(frame.width / 2, baseline);
      ctx.rotate(look.tilt);
      ctx.translate(-frame.width / 2, -baseline);
      fillTracked(ctx, artist.name, {
        x: frame.left,
        y: baseline,
        pixels: name.pixels,
        tracking: name.tracking,
        face: NARROW_FACE,
        color: inks.flame,
      });
      ctx.restore();
    }

    if (show.meta) {
      centred(ctx, frame, `${artist.number} / ${event.dateLabel} / ${event.venue}`, {
        y: frame.bottom,
        pixels: frame.unit * MICRO_PIXELS_UNITS,
        tracking: MICRO_TRACKING,
        color: inks.bone,
      });
    }
    if (show.credit && artist.credit) {
      centred(ctx, frame, artist.credit, {
        y: frame.bottom - frame.unit * MICRO_LEAD_UNITS,
        pixels: frame.unit * MICRO_PIXELS_UNITS,
        tracking: MICRO_TRACKING,
        color: inks.ember,
      });
    }

    if (!textOnly) {
      vignette(ctx, frame, { hex: inks.void, amount: VIGNETTE });
      grain(ctx, frame, random, GRAIN);
    }
  },
};
