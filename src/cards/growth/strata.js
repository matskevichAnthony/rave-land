/**
 * Пласты: горизонты, наложенные друг на друга, как разрез породы.
 *
 * Каждый пласт это лента между двумя линиями шума: своим горизонтом и горизонтом соседа
 * сверху. Толщину никто не назначает, она разница двух независимых рельефов, поэтому пласт
 * то выклинивается в ноль, то раздувается на четверть кадра.
 */

import { createNoise2D } from 'simplex-noise';
import { rgba } from '../ink.js';

const LAYERS = [7, 22];
const RELIEF_UNITS = [1.5, 9];
// Кровля пласта считается своим рельефом, подошва рельефом соседа: два разных сдвига по
// шуму, иначе лента получилась бы равномерной по толщине лапшой.
const ROOF_OFFSET = 31;
const ROUGHNESS = [1.2, 5.5];
const ALPHA = [0.3, 0.85];
const STEP_PX = 6;
// Часть пластов идёт штриховкой вместо заливки: сплошные заливки съедают кадр в три слоя.
const HATCH_ODDS = 0.4;
const HATCH_STEP_UNITS = [0.4, 1.6];

function hatch(ctx, frame, top, colour, step) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, top, frame.width, frame.height - top);
  ctx.clip();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = -frame.height; x < frame.width; x += step) {
    ctx.moveTo(x, frame.height);
    ctx.lineTo(x + frame.height, 0);
  }
  ctx.stroke();
  ctx.restore();
}

export default {
  id: 'strata',
  label: 'Пласты',
  grow(ctx, frame, random, palette) {
    const noise = createNoise2D(random);
    const layers = random.int(LAYERS[0], LAYERS[1]);
    const roughness = random.range(ROUGHNESS[0], ROUGHNESS[1]) / frame.width;
    const hatchStep = frame.unit * random.range(HATCH_STEP_UNITS[0], HATCH_STEP_UNITS[1]);

    const lead = frame.height / (layers + 1);
    for (let layer = layers; layer > 0; layer -= 1) {
      const base = lead * layer;
      const relief = frame.unit * random.range(RELIEF_UNITS[0], RELIEF_UNITS[1]);
      const colour = rgba(palette[layer % palette.length], random.range(ALPHA[0], ALPHA[1]));
      let top = base;
      ctx.beginPath();
      for (let x = 0; x <= frame.width; x += STEP_PX) {
        const y = base + noise(x * roughness, layer) * relief;
        top = Math.min(top, y);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let x = frame.width; x >= 0; x -= STEP_PX) {
        ctx.lineTo(x, base + lead + noise(x * roughness, layer + ROOF_OFFSET) * relief);
      }
      ctx.closePath();
      if (random() < HATCH_ODDS) {
        hatch(ctx, frame, top, colour, hatchStep);
      } else {
        ctx.fillStyle = colour;
        ctx.fill();
      }
    }
  },
};
