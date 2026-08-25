/**
 * Сигилы: готические знаки андерстава, нарисованные кодом.
 *
 * Символы шрифтом здесь ненадёжны: в Grenze Gotisch нет крестов и клейм, и глиф молча
 * пришёл бы из системного шрифта, у каждого зрителя своим. Поэтому каждый сигил это путь
 * на канвасе: крест с расклёшенными концами, стрельчатый проём, тройной шип, косой крест
 * с точками, ромб с крестом и клеймо-шеврон. Все шесть держат один вес штриха и рисуются
 * от единичного квадрата, метры приходят масштабом.
 *
 * Расстановка серийная: серийный поток решает, какой набор знаков и какой узор расстановки
 * держит серию (углы, подвал, фланги имени), карточный поток решает, какой именно знак
 * встанет в какое гнездо. Серия проштампована одинаково, карточки разнятся знаками.
 */

import { rgba } from './ink.js';

const STROKE = 0.09;

/** Крест с расклёшенными концами: балки сужаются к центру, как у пattée. */
function cross(ctx) {
  const arm = 0.5;
  const flare = 0.22;
  const waist = 0.07;
  for (let quarter = 0; quarter < 4; quarter += 1) {
    ctx.save();
    ctx.rotate((Math.PI / 2) * quarter);
    ctx.beginPath();
    ctx.moveTo(-waist, -waist);
    ctx.lineTo(-flare, -arm);
    ctx.lineTo(flare, -arm);
    ctx.lineTo(waist, -waist);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

/** Стрельчатый проём: контур ланцета, пустой внутри. */
function lancet(ctx) {
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.moveTo(-0.3, 0.5);
  ctx.lineTo(-0.3, -0.05);
  ctx.quadraticCurveTo(-0.3, -0.42, 0, -0.5);
  ctx.quadraticCurveTo(0.3, -0.42, 0.3, -0.05);
  ctx.lineTo(0.3, 0.5);
  ctx.closePath();
  ctx.stroke();
}

/** Тройной шип: три вертикали разной высоты, как решётка нефа. */
function trident(ctx) {
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  for (const [x, top] of [[-0.3, -0.24], [0, -0.5], [0.3, -0.24]]) {
    ctx.moveTo(x, 0.5);
    ctx.lineTo(x, top);
  }
  ctx.moveTo(-0.42, 0.5);
  ctx.lineTo(0.42, 0.5);
  ctx.stroke();
}

/** Косой крест с точками по осям: клеймо, а не буква. */
function saltire(ctx) {
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.moveTo(-0.38, -0.38);
  ctx.lineTo(0.38, 0.38);
  ctx.moveTo(0.38, -0.38);
  ctx.lineTo(-0.38, 0.38);
  ctx.stroke();
  for (const [x, y] of [[0, -0.46], [0, 0.46], [-0.46, 0], [0.46, 0]]) {
    ctx.beginPath();
    ctx.arc(x, y, STROKE * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Ромб с крестом внутри: печать на воротах. */
function seal(ctx) {
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.moveTo(0, -0.5);
  ctx.lineTo(0.5, 0);
  ctx.lineTo(0, 0.5);
  ctx.lineTo(-0.5, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -0.22);
  ctx.lineTo(0, 0.22);
  ctx.moveTo(-0.22, 0);
  ctx.lineTo(0.22, 0);
  ctx.stroke();
}

/** Шеврон стопкой: три угла вниз, индустриальное клеймо опасности. */
function chevron(ctx) {
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  for (let row = 0; row < 3; row += 1) {
    const y = -0.34 + row * 0.3;
    ctx.moveTo(-0.4, y);
    ctx.lineTo(0, y + 0.22);
    ctx.lineTo(0.4, y);
  }
  ctx.stroke();
}

const GLYPHS = [cross, lancet, trident, saltire, seal, chevron];

// Узоры расстановки: гнёзда в долях кадра. Серийный поток выбирает узор на всю серию.
const PATTERNS = [
  // Углы: четыре знака по углам полей.
  [[0.09, 0.08], [0.91, 0.08], [0.09, 0.92], [0.91, 0.92]],
  // Подвал: ряд из трёх знаков над нижним полем.
  [[0.3, 0.9], [0.5, 0.9], [0.7, 0.9]],
  // Фланги: пара знаков на середине высоты по краям.
  [[0.08, 0.5], [0.92, 0.5]],
  // Вертикаль: колонна из трёх знаков по правому краю.
  [[0.91, 0.3], [0.91, 0.5], [0.91, 0.7]],
];

const SIZE_UNITS = [2.4, 4.2];
const ALPHA = [0.5, 0.9];
const TILT = 0.12;

/**
 * Штамповка сигилов. Серийный поток решает узор, размер и число знаков в наборе,
 * карточный поток решает, какие именно знаки встанут в гнёзда и как дрогнут.
 */
export function drawSigils(ctx, frame, series, card, inks) {
  const pattern = series.pick(PATTERNS);
  const size = frame.unit * series.range(SIZE_UNITS[0], SIZE_UNITS[1]);
  const alpha = series.range(ALPHA[0], ALPHA[1]);
  // Набор серии: от двух до четырёх знаков из шести, чтобы серия не пользовалась всем сразу.
  const setSize = series.int(2, 4);
  const offset = series.int(0, GLYPHS.length - 1);
  const family = Array.from({ length: setSize }, (_, i) => GLYPHS[(offset + i * 2) % GLYPHS.length]);

  ctx.save();
  for (const [fx, fy] of pattern) {
    const glyph = card.pick(family);
    ctx.save();
    ctx.translate(
      frame.width * fx + card.range(-0.4, 0.4) * frame.unit,
      frame.height * fy + card.range(-0.4, 0.4) * frame.unit,
    );
    ctx.rotate(card.range(-TILT, TILT));
    ctx.scale(size, size);
    const paint = card() < 0.25 ? inks.ember : inks.bone;
    ctx.fillStyle = rgba(paint, alpha);
    ctx.strokeStyle = rgba(paint, alpha);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    glyph(ctx);
    ctx.restore();
  }
  ctx.restore();
}
