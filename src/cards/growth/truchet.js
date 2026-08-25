/**
 * Труше: плитки с дугами, повёрнутые как попало, сходятся в лабиринт без единого замысла.
 *
 * Каждая плитка знает только свою четверть окружности. Рисунок целого кадра, петли, тупики
 * и длинные ходы, не спроектирован никем: он следствие того, что соседние плитки вынуждены
 * стыковаться по краям.
 */

import { createNoise2D } from 'simplex-noise';
import { rgba } from '../ink.js';

const CELL_UNITS = [4, 11];
const WIDTH_RATIO = [0.06, 0.3];
const ALPHA = [0.35, 0.95];
// Часть плиток идёт прямыми вместо дуг: одни дуги укладываются слишком гладко и кадр
// становится обоями.
const STRAIGHT_ODDS = 0.22;
// Шум решает не поворот, а густоту: плитки собираются в пятна, а не рассыпаются ровно.
const FILL_FREQ = [1.5, 5];

export default {
  id: 'truchet',
  label: 'Труше',
  grow(ctx, frame, random, palette) {
    const noise = createNoise2D(random);
    const cell = frame.unit * random.range(CELL_UNITS[0], CELL_UNITS[1]);
    const cols = Math.ceil(frame.width / cell);
    const rows = Math.ceil(frame.height / cell);
    const freq = random.range(FILL_FREQ[0], FILL_FREQ[1]) / Math.max(cols, rows);
    const alpha = random.range(ALPHA[0], ALPHA[1]);

    ctx.lineWidth = cell * random.range(WIDTH_RATIO[0], WIDTH_RATIO[1]);
    ctx.lineCap = 'butt';
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        if (noise(col * freq * cols, row * freq * rows) < -0.35) continue;
        const x = col * cell;
        const y = row * cell;
        ctx.strokeStyle = rgba(palette[(row + col) % palette.length], alpha);
        ctx.beginPath();
        if (random() < STRAIGHT_ODDS) {
          const upright = random() < 0.5;
          ctx.moveTo(upright ? x + cell / 2 : x, upright ? y : y + cell / 2);
          ctx.lineTo(upright ? x + cell / 2 : x + cell, upright ? y + cell : y + cell / 2);
        } else if (random() < 0.5) {
          ctx.arc(x, y, cell / 2, 0, Math.PI / 2);
          ctx.moveTo(x + cell, y + cell / 2);
          ctx.arc(x + cell, y + cell, cell / 2, Math.PI, Math.PI * 1.5);
        } else {
          ctx.arc(x + cell, y, cell / 2, Math.PI / 2, Math.PI);
          ctx.moveTo(x, y + cell / 2);
          ctx.arc(x, y + cell, cell / 2, Math.PI * 1.5, Math.PI * 2);
        }
        ctx.stroke();
      }
    }
  },
};
