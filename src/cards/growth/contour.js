/**
 * Изолинии: marching squares по полю шума, как горизонтали на карте рельефа.
 *
 * Каждый уровень идёт своим цветом, и поле читается топографией местности, которой нет.
 */

import { createNoise2D } from 'simplex-noise';
import { rgba } from '../ink.js';

const CELL_UNITS = [1.1, 2.4];
const FREQ = [1.6, 4.6];
const LEVELS = [7, 16];
const WIDTH_UNITS = [0.12, 0.45];
const ALPHA = [0.3, 0.9];
const SPAN = 1.8;

/** Интерполяция пересечения изолинии с ребром клетки. */
function cross(a, b, iso) {
  const gap = b - a;
  return gap === 0 ? 0.5 : (iso - a) / gap;
}

export default {
  id: 'contour',
  label: 'Изолинии',
  grow(ctx, frame, random, palette) {
    const noise = createNoise2D(random);
    const cell = Math.max(5, frame.unit * random.range(CELL_UNITS[0], CELL_UNITS[1]));
    const cols = Math.ceil(frame.width / cell) + 1;
    const rows = Math.ceil(frame.height / cell) + 1;
    const freq = random.range(FREQ[0], FREQ[1]) / Math.max(cols, rows);

    const field = [];
    for (let row = 0; row < rows; row += 1) {
      field[row] = [];
      for (let col = 0; col < cols; col += 1) {
        field[row][col] = noise(col * cell * freq, row * cell * freq);
      }
    }

    const levels = random.int(LEVELS[0], LEVELS[1]);
    ctx.lineWidth = Math.max(1, frame.unit * random.range(WIDTH_UNITS[0], WIDTH_UNITS[1]));
    for (let level = 0; level < levels; level += 1) {
      const iso = -SPAN / 2 + (SPAN * level) / (levels - 1);
      ctx.strokeStyle = rgba(palette[level % palette.length], random.range(ALPHA[0], ALPHA[1]));
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
  },
};
