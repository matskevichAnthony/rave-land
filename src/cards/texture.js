/**
 * Фактура px-77: остаточный ключевой кадр, наложенный на готовую карточку.
 *
 * Приём тот же, что в датамоше сцены (`understav/pass-mosh.js`): вычесть ключевой кадр и
 * оставить блочный остаток. Здесь остаток не считается из движения, а выращивается из сида
 * фактуры: короткая сторона режется на 77 клеток, клетки зажигаются кустами вокруг
 * нескольких очагов, часть строк уезжает вбок, как строки битого потока.
 *
 * Сила наложения тоже сидовая и ходит широко: один сид фактуры почти не трогает карточку,
 * другой кладёт на неё плотную блочную сыпь. Так фактура реально видна в серии, а не
 * прячется в трёх процентах прозрачности.
 */

import { rgba } from './ink.js';
import { createLayer } from './layer.js';

// Имя приёма и есть число: 77 клеток по короткой стороне.
const GRID = 77;

const SEATS = [3, 7];
const SEAT_REACH = [0.08, 0.26];
const SEAT_BLOCKS = [90, 260];
const BLOCK_SPAN = [1, 4];
const BLOCK_ALPHA = [0.25, 0.9];

const ROW_SHIFTS = [4, 14];
const ROW_SHIFT_CELLS = [1.5, 9];

const STRENGTH = [0.18, 0.55];
const COLD_ODDS = 0.3;

/** Куст блоков вокруг очага: плотность падает от середины, как у остатка ключевого кадра. */
function paintSeat(ctx, cell, frame, random, inks) {
  const seat = {
    x: random.range(0, frame.width),
    y: random.range(0, frame.height),
    reach: random.range(SEAT_REACH[0], SEAT_REACH[1]) * frame.width,
  };
  const blocks = random.int(SEAT_BLOCKS[0], SEAT_BLOCKS[1]);
  const cold = random() < COLD_ODDS;
  for (let block = 0; block < blocks; block += 1) {
    const angle = random.range(0, Math.PI * 2);
    const away = random() * random() * seat.reach;
    const x = Math.floor((seat.x + Math.cos(angle) * away) / cell) * cell;
    const y = Math.floor((seat.y + Math.sin(angle) * away) / cell) * cell;
    const span = random.int(BLOCK_SPAN[0], BLOCK_SPAN[1]);
    const ink = random.pick(cold ? [inks.moon, inks.bone] : [inks.ember, inks.bone, inks.rust]);
    ctx.fillStyle = rgba(ink, random.range(BLOCK_ALPHA[0], BLOCK_ALPHA[1]));
    ctx.fillRect(x, y, cell * span, cell);
  }
}

/** Часть строк остатка уезжает вбок целиком: битый поток держит строку, но теряет столбец. */
function shiftRows(layer, cell, frame, random) {
  const rows = random.int(ROW_SHIFTS[0], ROW_SHIFTS[1]);
  for (let row = 0; row < rows; row += 1) {
    const y = Math.floor(random.range(0, frame.height) / cell) * cell;
    const shift = random.sign() * random.range(ROW_SHIFT_CELLS[0], ROW_SHIFT_CELLS[1]) * cell;
    layer.ctx.drawImage(
      layer.canvas,
      0, y, frame.width, cell,
      shift, y, frame.width, cell,
    );
  }
}

export function applyTexture(ctx, frame, random, inks) {
  const cell = Math.max(2, Math.min(frame.width, frame.height) / GRID);
  const layer = createLayer(frame.width, frame.height);

  const seats = random.int(SEATS[0], SEATS[1]);
  for (let seat = 0; seat < seats; seat += 1) paintSeat(layer.ctx, cell, frame, random, inks);
  shiftRows(layer, cell, frame, random);

  const strength = random.range(STRENGTH[0], STRENGTH[1]);
  ctx.save();
  // Два прохода: overlay вжигает блоки в свет и тень, обычный проход оставляет их видимыми
  // даже на ровном поле, где overlay почти нем.
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = strength;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = strength * 0.5;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();
}
