/**
 * Эффектор: разрушение готовой карточки в полную силу.
 *
 * Обычный износ из `wear.js` притворяется плёнкой и работает на трёх процентах. Эффектор
 * работает после всех слоёв и не притворяется: куски кадра пересаживаются в чужие места,
 * плашки инвертируются насквозь, полосы уезжают крупно, каналы расходятся широко. Всё
 * сидовое: один сид фактуры даёт один и тот же разгром.
 *
 * Порядок жёсткий: сначала геометрия (пересадки, полосы), потом цвет (инверсия, каналы).
 * В обратном порядке инверсные плашки резались бы полосами и читались бы мусором, а не
 * приёмом.
 */

import { rgba } from './ink.js';
import { createLayer } from './layer.js';
import { chromatic, slices } from './wear.js';

const GRAFTS = [6, 14];
const GRAFT_WIDTH = [0.12, 0.5];
const GRAFT_HEIGHT = [0.025, 0.12];
const GRAFT_THROW_X = 0.28;
const GRAFT_THROW_Y = 0.08;

const SLICE_BANDS = 12;
const SLICE_SHIFT_UNITS = 3.5;

const INVERTS = [2, 5];
const INVERT_WIDTH = [0.1, 0.6];
const INVERT_HEIGHT = [0.02, 0.1];

const FLASHES = [2, 6];
const FLASH_ALPHA = [0.14, 0.4];

const CHROMA_OFFSET_UNITS = 1.4;
const CHROMA_STRENGTH = 1;

/** Пересадки: кусок кадра снимается со своего места и приживается в чужом. */
function grafts(ctx, frame, random) {
  const source = createLayer(frame.width, frame.height);
  source.ctx.drawImage(ctx.canvas, 0, 0);
  const count = random.int(GRAFTS[0], GRAFTS[1]);
  for (let graft = 0; graft < count; graft += 1) {
    const width = frame.width * random.range(GRAFT_WIDTH[0], GRAFT_WIDTH[1]);
    const height = frame.height * random.range(GRAFT_HEIGHT[0], GRAFT_HEIGHT[1]);
    const x = random.range(0, frame.width - width);
    const y = random.range(0, frame.height - height);
    ctx.drawImage(
      source.canvas,
      x, y, width, height,
      x + random.range(-1, 1) * frame.width * GRAFT_THROW_X,
      y + random.range(-1, 1) * frame.height * GRAFT_THROW_Y,
      width, height,
    );
  }
}

/** Инверсия плашками: difference с белым переворачивает кусок кадра в негатив. */
function inverts(ctx, frame, random) {
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#ffffff';
  const count = random.int(INVERTS[0], INVERTS[1]);
  for (let plate = 0; plate < count; plate += 1) {
    ctx.fillRect(
      random.range(0, frame.width * 0.8),
      random.range(0, frame.height * 0.92),
      frame.width * random.range(INVERT_WIDTH[0], INVERT_WIDTH[1]),
      frame.height * random.range(INVERT_HEIGHT[0], INVERT_HEIGHT[1]),
    );
  }
  ctx.restore();
}

/** Цветные вспышки: тонкие плашки жара и холода, вжатые сложением. */
function flashes(ctx, frame, random, inks) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const count = random.int(FLASHES[0], FLASHES[1]);
  for (let flash = 0; flash < count; flash += 1) {
    ctx.fillStyle = rgba(
      random.pick([inks.ember, inks.moon, inks.blood]),
      random.range(FLASH_ALPHA[0], FLASH_ALPHA[1]),
    );
    ctx.fillRect(
      0,
      random.range(0, frame.height * 0.95),
      frame.width,
      frame.unit * random.range(0.6, 3),
    );
  }
  ctx.restore();
}

export function applyChaos(ctx, frame, random, inks) {
  grafts(ctx, frame, random);
  slices(ctx, frame, random, { bands: SLICE_BANDS, shift: frame.unit * SLICE_SHIFT_UNITS });
  inverts(ctx, frame, random);
  flashes(ctx, frame, random, inks);
  chromatic(ctx, frame, {
    offset: frame.unit * CHROMA_OFFSET_UNITS,
    strength: CHROMA_STRENGTH,
  });
}
