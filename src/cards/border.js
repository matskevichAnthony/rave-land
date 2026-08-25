/**
 * Обрамление карточки: индустриальная готика по краю кадра.
 *
 * Три руки, все нарисованы кодом и живут на сиде. Арка кладёт тёмный портал со стрельчатым
 * окном, как неф UNDERSTAV в разрезе; клёпка обшивает край стальной полосой с заклёпками;
 * шипы режут кромку пилой внутрь. Четвёртый режим, хаос, отдаёт выбор серийному потоку:
 * стиль один на серию, а карточный поток гуляет только в толщине и деталях, поэтому шесть
 * карточек оправлены одинаково, но не под копирку.
 *
 * Рамка идёт после эффектора и до плашки: разгром остаётся внутри оправы, как за стеклом,
 * а набор плашки ложится поверх всего.
 */

import { rgba } from './ink.js';

export const BORDERS = [
  { id: 'none', label: 'Нет' },
  { id: 'arch', label: 'Арка' },
  { id: 'rivet', label: 'Клёпка' },
  { id: 'spike', label: 'Шипы' },
  { id: 'chaos', label: 'Хаос' },
];

const ARCH_INSET_UNITS = [2.2, 3.6];
const ARCH_PEAK = [0.12, 0.2];
const ARCH_LINE_UNITS = 0.35;

const RIVET_BAND_UNITS = [1.6, 2.6];
const RIVET_STEP_UNITS = [3.5, 5.5];
const RIVET_R_UNITS = 0.42;

const SPIKE_DEPTH_UNITS = [1.4, 2.8];
const SPIKE_STEP_UNITS = [2.2, 3.8];

/** Стрельчатое окно: две дуги сходятся в замок остриём, кадр живёт внутри портала. */
function archPath(ctx, frame, inset, peak) {
  const left = inset;
  const right = frame.width - inset;
  const bottom = frame.height - inset;
  const apexY = inset;
  // Пята арки: ниже замка на долю высоты кадра, отсюда начинается стрельчатый свод.
  const springY = inset + frame.height * peak * 2;
  const midX = frame.width / 2;
  ctx.moveTo(left, bottom);
  ctx.lineTo(left, springY);
  // Две квадратичные дуги с изломом касательной в замке: остриё, а не купол.
  ctx.quadraticCurveTo(left, apexY + (springY - apexY) * 0.2, midX, apexY);
  ctx.quadraticCurveTo(right, apexY + (springY - apexY) * 0.2, right, springY);
  ctx.lineTo(right, bottom);
  ctx.closePath();
}

/** Арка: тёмный портал вокруг кадра со стрельчатым проёмом и тонкой жаркой обводкой. */
function drawArch(ctx, frame, series, card, inks) {
  const inset = frame.unit * series.range(ARCH_INSET_UNITS[0], ARCH_INSET_UNITS[1])
    * card.range(0.94, 1.06);
  const peak = series.range(ARCH_PEAK[0], ARCH_PEAK[1]);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, frame.width, frame.height);
  archPath(ctx, frame, inset, peak);
  ctx.fill('evenodd');
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  archPath(ctx, frame, inset, peak);
  ctx.strokeStyle = inks.ember;
  ctx.lineWidth = frame.unit * ARCH_LINE_UNITS;
  ctx.stroke();
  ctx.restore();
}

/** Клёпка: стальная полоса по периметру, заклёпки идут равным шагом. */
function drawRivet(ctx, frame, series, card, inks) {
  const band = frame.unit * series.range(RIVET_BAND_UNITS[0], RIVET_BAND_UNITS[1]);
  const step = frame.unit * series.range(RIVET_STEP_UNITS[0], RIVET_STEP_UNITS[1]);
  const radius = frame.unit * RIVET_R_UNITS;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, frame.width, frame.height);
  ctx.rect(band, band, frame.width - band * 2, frame.height - band * 2);
  ctx.fill('evenodd');

  ctx.strokeStyle = rgba(inks.bone, 0.25);
  ctx.lineWidth = 1;
  ctx.strokeRect(band, band, frame.width - band * 2, frame.height - band * 2);

  ctx.fillStyle = inks.bone;
  const mid = band / 2;
  const jitter = () => card.range(-0.15, 0.15) * band;
  const rivet = (x, y) => {
    ctx.beginPath();
    ctx.arc(x + jitter(), y + jitter(), radius, 0, Math.PI * 2);
    ctx.fill();
  };
  for (let x = step; x < frame.width - step / 2; x += step) {
    rivet(x, mid);
    rivet(x, frame.height - mid);
  }
  for (let y = step; y < frame.height - step / 2; y += step) {
    rivet(mid, y);
    rivet(frame.width - mid, y);
  }
  ctx.restore();
}

/** Шипы: пила режет кромку внутрь, изредка зуб раскаляется жаром. */
function drawSpike(ctx, frame, series, card, inks) {
  const depth = frame.unit * series.range(SPIKE_DEPTH_UNITS[0], SPIKE_DEPTH_UNITS[1]);
  const step = frame.unit * series.range(SPIKE_STEP_UNITS[0], SPIKE_STEP_UNITS[1]);
  const emberOdds = series.range(0.06, 0.16);

  const tooth = (x, y, dx, dy) => {
    // Зуб строится в локальных осях кромки: (dx, dy) ведёт вдоль края.
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * step / 2 - dy * depth, y + dy * step / 2 + dx * depth);
    ctx.lineTo(x + dx * step, y + dy * step);
    ctx.closePath();
    ctx.fillStyle = card() < emberOdds ? inks.ember : inks.void;
    ctx.fill();
  };

  ctx.save();
  for (let x = 0; x < frame.width; x += step) tooth(x, 0, 1, 0);
  for (let x = frame.width; x > 0; x -= step) tooth(x, frame.height, -1, 0);
  for (let y = frame.height; y > 0; y -= step) tooth(0, y, 0, -1);
  for (let y = 0; y < frame.height; y += step) tooth(frame.width, y, 0, 1);
  ctx.restore();
}

const HANDS = { arch: drawArch, rivet: drawRivet, spike: drawSpike };

export function drawBorder(ctx, frame, style, series, card, inks) {
  if (style === 'none') return;
  ctx.save();
  ctx.fillStyle = inks.void;
  const hand = style === 'chaos' ? HANDS[series.pick(Object.keys(HANDS))] : HANDS[style];
  hand(ctx, frame, series, card, inks);
  ctx.restore();
}
