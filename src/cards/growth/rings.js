/**
 * Кольца: замкнутые контуры вокруг сорванного центра, радиус дышит шумом по углу.
 *
 * Центр никогда не в середине кадра: строго по центру кольца читаются мишенью, а не полем.
 */

import { createNoise2D } from 'simplex-noise';
import { rgba } from '../ink.js';

const COUNT = [9, 24];
const SEGMENTS = 90;
const WOBBLE_UNITS = [1.5, 7];
const WIDTH_UNITS = [0.12, 0.5];
const ALPHA = [0.25, 0.8];
const CENTRE = [0.22, 0.78];
const REACH = 0.62;
const TWIST = [0.6, 2.4];

export default {
  id: 'rings',
  label: 'Кольца',
  grow(ctx, frame, random, palette) {
    const noise = createNoise2D(random);
    const centreX = frame.width * random.range(CENTRE[0], CENTRE[1]);
    const centreY = frame.height * random.range(CENTRE[0], CENTRE[1]);
    const count = random.int(COUNT[0], COUNT[1]);
    const reach = Math.hypot(frame.width, frame.height) * REACH;
    const wobble = frame.unit * random.range(WOBBLE_UNITS[0], WOBBLE_UNITS[1]);
    const twist = random.range(TWIST[0], TWIST[1]);

    for (let ring = 1; ring <= count; ring += 1) {
      const base = (reach * ring) / count;
      ctx.strokeStyle = rgba(palette[ring % palette.length], random.range(ALPHA[0], ALPHA[1]));
      ctx.lineWidth = Math.max(1, frame.unit * random.range(WIDTH_UNITS[0], WIDTH_UNITS[1]));
      ctx.beginPath();
      for (let segment = 0; segment <= SEGMENTS; segment += 1) {
        const angle = (Math.PI * 2 * segment) / SEGMENTS;
        const radius = base + noise(Math.cos(angle) * twist, Math.sin(angle) * twist + ring) * wobble;
        const x = centreX + Math.cos(angle) * radius;
        const y = centreY + Math.sin(angle) * radius;
        if (segment === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  },
};
