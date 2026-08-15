/**
 * Шероховатость и грязь, нарисованные на canvas.
 *
 * Модуль не знает ни одной сцены: снаружи приходят размер, плотность, контраст и поток
 * случайности, обратно уходит текстура. Карта поверхности рисуется бесшовной, каждый мазок
 * кладётся ещё и во всех сдвигах на сторону: её вешают на десятки метров стены повтором,
 * а не растяжением, и шов был бы виден на каждом стыке.
 */

import * as THREE from 'three';
import { between } from './random.js';
import { rgba } from './canvas-texture.js';

const TAU = Math.PI * 2;
const HALF = 0.5;
const CHANNEL_MAX = 255;

const SURFACE = {
  size: 256,
  spots: 70,
  spotRadius: [0.04, 0.24],
  spotAlpha: [0.2, 0.75],
  streaks: 22,
  streakWidth: [0.006, 0.028],
  streakLength: [0.12, 0.55],
  streakAlpha: [0.12, 0.45],
  grain: 2400,
  grainAlpha: [0.05, 0.2],
  range: [0.45, 1],
};

const ATLAS = { size: 512, columns: 2, rows: 2 };

const STAIN = {
  inset: 0.2,
  blotRadius: [0.12, 0.28],
  blotAlpha: [0.3, 0.75],
  dripWidth: [0.05, 0.16],
  dripLength: [0.4, 0.92],
  dripAlpha: [0.25, 0.7],
};

const STENCIL = {
  inset: 0.12,
  chevrons: 3,
  thickness: 0.07,
  rise: 0.09,
  gaps: 14,
  gapRadius: [0.02, 0.07],
};

const PLACARD = {
  inset: 0.06,
  headline: { top: 0.1, height: 0.2, alpha: 0.9 },
  rows: 5,
  rowTop: 0.42,
  rowStep: 0.11,
  rowHeight: 0.045,
  rowWidth: [0.28, 0.76],
  rowAlpha: [0.35, 0.85],
  tears: 9,
  tearRadius: [0.03, 0.12],
};

function canvasOf(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/** Серый нужной светлоты: карта данных читается по каналу, а не по цвету. */
function grey(level, alpha) {
  const channel = Math.round(Math.min(Math.max(level, 0), 1) * CHANNEL_MAX);
  return `rgba(${channel}, ${channel}, ${channel}, ${alpha})`;
}

function wrapped(size, x, y, reach, paint) {
  for (let tileX = -1; tileX <= 1; tileX += 1) {
    for (let tileY = -1; tileY <= 1; tileY += 1) {
      const shiftedX = x + tileX * size;
      const shiftedY = y + tileY * size;
      const outside = shiftedX + reach < 0 || shiftedX - reach > size
        || shiftedY + reach < 0 || shiftedY - reach > size;
      if (!outside) paint(shiftedX, shiftedY);
    }
  }
}

function edgePoint(box, edge, along) {
  if (edge === 0) return [box.x + along * box.width, box.y];
  if (edge === 1) return [box.x + box.width, box.y + along * box.height];
  if (edge === 2) return [box.x + along * box.width, box.y + box.height];
  return [box.x, box.y + along * box.height];
}

/** Мягкое пятно: `shade(доля)` отдаёт цвет от середины к прозрачному краю. */
function softSpot(ctx, x, y, radius, shade) {
  const spot = ctx.createRadialGradient(x, y, 0, x, y, radius);
  spot.addColorStop(0, shade(1));
  spot.addColorStop(1, shade(0));
  ctx.fillStyle = spot;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

/** Потёк сверху вниз: гаснет с обоих концов, поэтому у мазка нет обрубленного края. */
function smear(ctx, x, y, width, length, shade) {
  const trail = ctx.createLinearGradient(x, y, x, y + length);
  trail.addColorStop(0, shade(0));
  trail.addColorStop(0.3, shade(1));
  trail.addColorStop(1, shade(0));
  ctx.fillStyle = trail;
  ctx.fillRect(x - width * HALF, y, width, length);
}

/**
 * Карта шероховатости: пятна, разводы и зерно в оттенках серого.
 *
 * Белое это шероховатость материала как она есть, тёмное её сбавляет, поэтому размах
 * `range` задаёт контраст, а не яркость.
 */
export function createSurfaceGrunge({
  random,
  size = SURFACE.size,
  spots = SURFACE.spots,
  spotRadius = SURFACE.spotRadius,
  streaks = SURFACE.streaks,
  grain = SURFACE.grain,
  range = SURFACE.range,
}) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const [low, high] = range;
  const middle = (low + high) * HALF;

  ctx.fillStyle = grey(high, 1);
  ctx.fillRect(0, 0, size, size);

  for (let index = 0; index < spots; index += 1) {
    const radius = between(random, ...spotRadius) * size;
    const level = between(random, low, middle);
    const alpha = between(random, ...SURFACE.spotAlpha);
    wrapped(size, random() * size, random() * size, radius, (x, y) => {
      softSpot(ctx, x, y, radius, (share) => grey(level, alpha * share));
    });
  }

  for (let index = 0; index < streaks; index += 1) {
    const width = between(random, ...SURFACE.streakWidth) * size;
    const length = between(random, ...SURFACE.streakLength) * size;
    const level = between(random, low, middle);
    const alpha = between(random, ...SURFACE.streakAlpha);
    wrapped(size, random() * size, random() * size, length, (x, y) => {
      smear(ctx, x, y, width, length, (share) => grey(level, alpha * share));
    });
  }

  for (let index = 0; index < grain; index += 1) {
    ctx.fillStyle = grey(between(random, low, high), between(random, ...SURFACE.grainAlpha));
    ctx.fillRect(Math.floor(random() * size), Math.floor(random() * size), 1, 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Копия карты со своим шагом повтора: шаг меряется метрами поверхности.
 *
 * Копия делит с оригиналом источник, поэтому в память видеокарты картинка уезжает один раз,
 * а разъезжаются у них только развёртки.
 */
export function tileToMeters(texture, { width, height, tile }) {
  const copy = texture.clone();
  copy.repeat.set(width / tile, height / tile);
  return copy;
}

/**
 * Атлас: клетки рисует вызывающий, наружу уходит их развёртка.
 *
 * Одна текстура на пачку декалей нужна затем, что декали с общим материалом собираются в
 * один меш. Своя текстура на пятно это свой вызов отрисовки на пятно.
 */
export function createAtlas({
  size = ATLAS.size,
  columns = ATLAS.columns,
  rows = ATLAS.rows,
  paint,
}) {
  const canvas = canvasOf(size);
  const ctx = canvas.getContext('2d');
  const cellWidth = size / columns;
  const cellHeight = size / rows;
  const cells = [];

  for (let index = 0; index < columns * rows; index += 1) {
    const box = {
      x: (index % columns) * cellWidth,
      y: Math.floor(index / columns) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.clip();
    paint(ctx, box, index);
    ctx.restore();
    // Развёртка считает снизу, canvas сверху: по вертикали клетка переворачивается.
    cells.push({
      u: box.x / size,
      v: 1 - (box.y + box.height) / size,
      width: box.width / size,
      height: box.height / size,
    });
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, cells };
}

/** Грязь в клетке: пятна и потёки. Фон отдаётся снаружи, он же задаёт нейтральный цвет. */
export function paintStains(ctx, box, {
  random,
  ink,
  base,
  blots = 0,
  drips = 0,
  blotRadius = STAIN.blotRadius,
  blotAlpha = STAIN.blotAlpha,
}) {
  if (base) {
    ctx.fillStyle = base;
    ctx.fillRect(box.x, box.y, box.width, box.height);
  }
  const inset = box.width * STAIN.inset;

  for (let index = 0; index < blots; index += 1) {
    const radius = between(random, ...blotRadius) * box.width;
    const alpha = between(random, ...blotAlpha);
    softSpot(
      ctx,
      box.x + between(random, inset, box.width - inset),
      box.y + between(random, inset, box.height - inset),
      radius,
      (share) => rgba(ink, alpha * share),
    );
  }

  for (let index = 0; index < drips; index += 1) {
    const alpha = between(random, ...STAIN.dripAlpha);
    smear(
      ctx,
      box.x + between(random, inset, box.width - inset),
      box.y + between(random, 0, inset),
      between(random, ...STAIN.dripWidth) * box.width,
      between(random, ...STAIN.dripLength) * box.height,
      (share) => rgba(ink, alpha * share),
    );
  }
}

/** Трафаретный знак: шевроны с выеденной краской. */
export function paintStencil(ctx, box, { random, ink, chevrons = STENCIL.chevrons }) {
  const inset = box.width * STENCIL.inset;
  const rise = box.height * STENCIL.rise;
  ctx.strokeStyle = rgba(ink, 1);
  ctx.lineWidth = box.height * STENCIL.thickness;

  for (let index = 0; index < chevrons; index += 1) {
    const y = box.y + inset + ((index + HALF) / chevrons) * (box.height - inset * 2);
    ctx.beginPath();
    ctx.moveTo(box.x + inset, y - rise);
    ctx.lineTo(box.x + box.width * HALF, y + rise);
    ctx.lineTo(box.x + box.width - inset, y - rise);
    ctx.stroke();
  }

  // Краску кладут через прорези, и она рвётся: без прорех знак читается наклейкой.
  ctx.globalCompositeOperation = 'destination-out';
  for (let index = 0; index < STENCIL.gaps; index += 1) {
    ctx.beginPath();
    ctx.arc(
      box.x + random() * box.width,
      box.y + random() * box.height,
      between(random, ...STENCIL.gapRadius) * box.width,
      0,
      TAU,
    );
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Афиша: бумага, шапка, строки текста полосами и рваные края. */
export function paintPlacard(ctx, box, { random, paper, ink, rows = PLACARD.rows }) {
  const inset = box.width * PLACARD.inset;
  const x = box.x + inset;
  const y = box.y + inset;
  const width = box.width - inset * 2;
  const height = box.height - inset * 2;

  ctx.fillStyle = rgba(paper, 1);
  ctx.fillRect(x, y, width, height);

  ctx.fillStyle = rgba(ink, PLACARD.headline.alpha);
  ctx.fillRect(
    x + width * PLACARD.inset,
    y + height * PLACARD.headline.top,
    width * (1 - PLACARD.inset * 2),
    height * PLACARD.headline.height,
  );

  for (let index = 0; index < rows; index += 1) {
    ctx.fillStyle = rgba(ink, between(random, ...PLACARD.rowAlpha));
    ctx.fillRect(
      x + width * PLACARD.inset,
      y + height * (PLACARD.rowTop + index * PLACARD.rowStep),
      width * between(random, ...PLACARD.rowWidth),
      height * PLACARD.rowHeight,
    );
  }

  // Бумага на стене рвётся с краёв, поэтому край выедается, а не режется по линейке.
  ctx.globalCompositeOperation = 'destination-out';
  for (let index = 0; index < PLACARD.tears; index += 1) {
    const [tearX, tearY] = edgePoint(box, Math.floor(random() * 4), random());
    ctx.beginPath();
    ctx.arc(tearX, tearY, between(random, ...PLACARD.tearRadius) * box.width, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}
