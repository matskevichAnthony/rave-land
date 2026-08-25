/**
 * Мозаика: крупная сыпь цветных ячеек, часть рядов уезжает вбок.
 *
 * Самое грубое семейство набора и единственное, которое читается пикселем, а не линией.
 */

import { rgba } from '../ink.js';

const COLS = [9, 26];
const DENSITY = [0.2, 0.65];
const ALPHA = [0.4, 1];
const SHIFT_ODDS = 0.35;
const SIZE = [0.4, 1];

export default {
  id: 'blocks',
  label: 'Мозаика',
  grow(ctx, frame, random, palette) {
    const cols = random.int(COLS[0], COLS[1]);
    const cell = frame.width / cols;
    const rows = Math.ceil(frame.height / cell);
    const density = random.range(DENSITY[0], DENSITY[1]);
    for (let row = 0; row < rows; row += 1) {
      const shift = random() < SHIFT_ODDS ? random.range(-cell, cell) : 0;
      for (let col = -1; col <= cols; col += 1) {
        if (random() > density) continue;
        ctx.fillStyle = rgba(random.pick(palette), random.range(ALPHA[0], ALPHA[1]));
        ctx.fillRect(
          col * cell + shift,
          row * cell,
          cell * random.range(SIZE[0], SIZE[1]),
          cell * random.range(SIZE[0], SIZE[1]),
        );
      }
    }
  },
};
