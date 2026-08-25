/**
 * Поток: частицы текут по полю углов и оставляют след волокнами.
 *
 * Ни одна линия здесь не задана: она след того, куда снесло точку полем шума. Оттого поток
 * никогда не повторяет сам себя даже внутри одного кадра.
 */

import { createNoise2D } from 'simplex-noise';
import { rgba } from '../ink.js';

const COUNT = [150, 430];
const STEPS = [30, 130];
const STEP_UNITS = [0.5, 1.5];
const CURL = [1.4, 4.2];
const WIDTH_UNITS = [0.1, 0.5];
const ALPHA = [0.1, 0.45];

export default {
  id: 'flow',
  label: 'Поток',
  grow(ctx, frame, random, palette) {
    const noise = createNoise2D(random);
    const freq = random.range(CURL[0], CURL[1]) / Math.min(frame.width, frame.height);
    const curl = random.range(CURL[0], CURL[1]);
    const count = random.int(COUNT[0], COUNT[1]);
    const steps = random.int(STEPS[0], STEPS[1]);
    const stride = frame.unit * random.range(STEP_UNITS[0], STEP_UNITS[1]);

    ctx.lineCap = 'round';
    for (let particle = 0; particle < count; particle += 1) {
      let x = random.range(0, frame.width);
      let y = random.range(0, frame.height);
      ctx.strokeStyle = rgba(random.pick(palette), random.range(ALPHA[0], ALPHA[1]));
      ctx.lineWidth = Math.max(1, frame.unit * random.range(WIDTH_UNITS[0], WIDTH_UNITS[1]));
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
  },
};
