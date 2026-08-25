/**
 * Раскол: кадр рекурсивно делится надвое, пока куски не станут мельче предела.
 *
 * Композиции здесь нет вовсе, есть одно правило деления, применённое к самому себе. Крупные
 * пустые плиты рядом с мелкой крошкой получаются не потому, что так задумано, а потому что
 * рекурсия в одном месте остановилась рано, а в другом ушла на всю глубину.
 */

import { rgba } from '../ink.js';

const DEPTH = [4, 8];
const SPLIT = [0.28, 0.72];
// Ниже этой доли короткой стороны кусок не делится: дальше начинается сыпь, а не раскол.
const FLOOR_UNITS = 3;
const FILL_ODDS = 0.42;
const FILL_ALPHA = [0.15, 0.75];
const EDGE_ALPHA = [0.3, 0.9];
const EDGE_UNITS = [0.08, 0.4];
const GAP_UNITS = [0, 0.6];

export default {
  id: 'shatter',
  label: 'Раскол',
  grow(ctx, frame, random, palette) {
    const floor = frame.unit * FLOOR_UNITS;
    const gap = frame.unit * random.range(GAP_UNITS[0], GAP_UNITS[1]);
    ctx.lineWidth = Math.max(1, frame.unit * random.range(EDGE_UNITS[0], EDGE_UNITS[1]));

    const split = (x, y, width, height, depth) => {
      const done = depth <= 0 || Math.min(width, height) < floor;
      if (done) {
        if (random() < FILL_ODDS) {
          ctx.fillStyle = rgba(random.pick(palette), random.range(FILL_ALPHA[0], FILL_ALPHA[1]));
          ctx.fillRect(x + gap, y + gap, width - gap * 2, height - gap * 2);
        }
        ctx.strokeStyle = rgba(random.pick(palette), random.range(EDGE_ALPHA[0], EDGE_ALPHA[1]));
        ctx.strokeRect(x + gap, y + gap, width - gap * 2, height - gap * 2);
        return;
      }
      const share = random.range(SPLIT[0], SPLIT[1]);
      if (width > height) {
        split(x, y, width * share, height, depth - 1);
        split(x + width * share, y, width * (1 - share), height, depth - 1);
      } else {
        split(x, y, width, height * share, depth - 1);
        split(x, y + height * share, width, height * (1 - share), depth - 1);
      }
    };

    split(0, 0, frame.width, frame.height, random.int(DEPTH[0], DEPTH[1]));
  },
};
