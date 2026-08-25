/**
 * Генеративное поле: абстракция, которая живёт сама и дышит от звука.
 *
 * Отличие от поля на афише принципиальное, и поэтому здесь свой код, а не общий с
 * `cards/directions/mutant.js`. Там поле рисуется один раз по сиду и обязано быть
 * одинаковым навсегда. Здесь оно обязано двигаться: шум трёхмерный, третья ось это время,
 * а бюджет кадра держится не аккуратностью, а размером буфера.
 *
 * Буфер меньше экрана и растягивается на выводе. Проектор в зале мылит сильнее любой
 * растяжки, а разница в цене кадра между честными 1920 и 720 по ширине это разница между
 * шестьюдесятью кадрами и тридцатью.
 */

import { createNoise3D } from 'simplex-noise';
import { rgba } from '../cards/ink.js';

export const FIELDS = [
  { id: 'flow', label: 'Поток' },
  { id: 'contour', label: 'Изолинии' },
  { id: 'blocks', label: 'Мозаика' },
  { id: 'rings', label: 'Кольца' },
];

export const DEFAULT_FIELD = FIELDS[0].id;

// Ширина буфера поля: высота считается по кадру, чтобы поле не растягивалось овалом.
const BUFFER_WIDTH = 720;

// Поток: частицы живут между кадрами, след остаётся на буфере и медленно гаснет.
const PARTICLES = 320;
const TRAIL_FADE = 0.14;
const STEP_PX = [1.5, 5.5];
const CURL = 2.6;
const NOISE_SCALE = 0.0022;

// Изолинии: сетка в пикселях буфера и число уровней.
const CONTOUR_CELL = 26;
const CONTOUR_LEVELS = 9;
const CONTOUR_SPAN = 1.6;

// Мозаика: сколько ячеек по ширине и какая доля из них загорается.
const BLOCK_COLS = 22;
const BLOCK_BASE_DENSITY = 0.12;

// Кольца: сколько контуров и как сильно их гнёт шум.
const RING_COUNT = 14;
const RING_SEGMENTS = 72;
const RING_WOBBLE = 40;

// Время идёт своей осью шума, и скорость с пульта это её ход. Звук добавляется сверху:
// на громком месте поле течёт быстрее, чем на тихом.
const TIME_SCALE = 0.00016;
const LEVEL_SPEED = 2.4;

function cross(a, b, iso) {
  const gap = b - a;
  return gap === 0 ? 0.5 : (iso - a) / gap;
}

function contour(ctx, { width, height, noise, at, palette, level, alpha }) {
  const cols = Math.ceil(width / CONTOUR_CELL) + 1;
  const rows = Math.ceil(height / CONTOUR_CELL) + 1;
  const grid = [];
  for (let row = 0; row < rows; row += 1) {
    grid[row] = [];
    for (let col = 0; col < cols; col += 1) {
      grid[row][col] = noise(col * CONTOUR_CELL * NOISE_SCALE, row * CONTOUR_CELL * NOISE_SCALE, at);
    }
  }
  ctx.lineWidth = 1 + level * 3;
  for (let step = 0; step < CONTOUR_LEVELS; step += 1) {
    const iso = -CONTOUR_SPAN / 2 + (CONTOUR_SPAN * step) / (CONTOUR_LEVELS - 1);
    ctx.strokeStyle = rgba(palette[step % palette.length], alpha);
    ctx.beginPath();
    for (let row = 0; row < rows - 1; row += 1) {
      for (let col = 0; col < cols - 1; col += 1) {
        const tl = grid[row][col];
        const tr = grid[row][col + 1];
        const br = grid[row + 1][col + 1];
        const bl = grid[row + 1][col];
        const x = col * CONTOUR_CELL;
        const y = row * CONTOUR_CELL;
        const points = [];
        if ((tl < iso) !== (tr < iso)) points.push([x + CONTOUR_CELL * cross(tl, tr, iso), y]);
        if ((tr < iso) !== (br < iso)) points.push([x + CONTOUR_CELL, y + CONTOUR_CELL * cross(tr, br, iso)]);
        if ((bl < iso) !== (br < iso)) points.push([x + CONTOUR_CELL * cross(bl, br, iso), y + CONTOUR_CELL]);
        if ((tl < iso) !== (bl < iso)) points.push([x, y + CONTOUR_CELL * cross(tl, bl, iso)]);
        if (points.length >= 2) {
          ctx.moveTo(points[0][0], points[0][1]);
          ctx.lineTo(points[1][0], points[1][1]);
        }
      }
    }
    ctx.stroke();
  }
}

function blocks(ctx, { width, height, noise, at, palette, level, alpha }) {
  const cell = width / BLOCK_COLS;
  const rows = Math.ceil(height / cell);
  const density = BLOCK_BASE_DENSITY + level * 0.5;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < BLOCK_COLS; col += 1) {
      const value = noise(col * 0.14, row * 0.14, at * 3);
      if ((value + 1) / 2 > 1 - density) {
        ctx.fillStyle = rgba(palette[(row + col) % palette.length], alpha);
        ctx.fillRect(col * cell, row * cell, cell * (0.4 + value * 0.6), cell);
      }
    }
  }
}

function rings(ctx, { width, height, noise, at, palette, level, alpha }) {
  const centreX = width * (0.5 + noise(0, 0, at) * 0.22);
  const centreY = height * (0.5 + noise(9, 9, at) * 0.22);
  const reach = Math.hypot(width, height) * 0.55;
  ctx.lineWidth = 1 + level * 4;
  for (let ring = 1; ring <= RING_COUNT; ring += 1) {
    const base = (reach * ring) / RING_COUNT;
    ctx.strokeStyle = rgba(palette[ring % palette.length], alpha);
    ctx.beginPath();
    for (let segment = 0; segment <= RING_SEGMENTS; segment += 1) {
      const angle = (Math.PI * 2 * segment) / RING_SEGMENTS;
      const wobble = noise(Math.cos(angle) * 1.4, Math.sin(angle) * 1.4 + ring, at * 2);
      const radius = base + wobble * RING_WOBBLE * (1 + level * 2);
      const x = centreX + Math.cos(angle) * radius;
      const y = centreY + Math.sin(angle) * radius;
      if (segment === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

/** Поток держит частицы между кадрами, поэтому живёт не функцией, а замыканием. */
function createFlow(width, height) {
  const swarm = Array.from({ length: PARTICLES }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    tint: Math.floor(Math.random() * 6),
  }));

  return (ctx, { noise, at, palette, level, alpha }) => {
    const stride = STEP_PX[0] + (STEP_PX[1] - STEP_PX[0]) * level;
    ctx.lineWidth = 1 + level * 2;
    ctx.lineCap = 'round';
    for (const particle of swarm) {
      const angle = noise(particle.x * NOISE_SCALE, particle.y * NOISE_SCALE, at) * Math.PI * CURL;
      const nextX = particle.x + Math.cos(angle) * stride;
      const nextY = particle.y + Math.sin(angle) * stride;
      ctx.strokeStyle = rgba(palette[particle.tint % palette.length], alpha);
      ctx.beginPath();
      ctx.moveTo(particle.x, particle.y);
      ctx.lineTo(nextX, nextY);
      ctx.stroke();
      const outside = nextX < 0 || nextY < 0 || nextX > width || nextY > height;
      particle.x = outside ? Math.random() * width : nextX;
      particle.y = outside ? Math.random() * height : nextY;
    }
  };
}

export function createField(aspect) {
  const canvas = document.createElement('canvas');
  canvas.width = BUFFER_WIDTH;
  canvas.height = Math.round(BUFFER_WIDTH / aspect);
  const ctx = canvas.getContext('2d');
  const noise = createNoise3D();
  const flow = createFlow(canvas.width, canvas.height);
  let clock = 0;

  return {
    canvas,
    /**
     * Кадр поля. Поток стирается следом, остальные алгоритмы чистым листом: у потока весь
     * рисунок и есть накопленный след, а у изолиний след превращается в грязь за три секунды.
     */
    draw({ kind, palette, speed, level, alpha, hit }) {
      clock += (speed + level * LEVEL_SPEED) * TIME_SCALE * 1000;
      const at = clock + (hit ? 0.4 : 0);
      const shot = { width: canvas.width, height: canvas.height, noise, at, palette, level, alpha };
      if (kind === 'flow') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';
        flow(ctx, shot);
        return canvas;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (kind === 'contour') contour(ctx, shot);
      if (kind === 'blocks') blocks(ctx, shot);
      if (kind === 'rings') rings(ctx, shot);
      return canvas;
    },
  };
}
