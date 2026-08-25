/**
 * Автомат: одномерный клеточный автомат, разворачивающийся вниз строка за строкой.
 *
 * Правило целиком лежит в одном байте, и весь рисунок кадра выведен из него и одной
 * стартовой строки. Ничего похожего на «нарисовать красиво» здесь нет: правило либо родит
 * треугольники Серпинского, либо шум, либо полосы, и предсказать это можно только запуском.
 *
 * Набор правил отобран руками. Из двухсот пятидесяти шести большинство вырождается в
 * пустоту или в равномерную заливку за десять строк, и в серии афиш такая карточка выглядит
 * не строго, а сломанно.
 */

import { rgba } from '../ink.js';

// Правило и старт связаны, и это не мелочь. Хаотические правила из одной клетки дают
// знаменитый рваный треугольник, а из случайной строки вырождаются в ровную сыпь, которая
// на афише читается не структурой, а грязью. Узорные правила держат рисунок с любого старта.
const CHAOTIC_RULES = [30, 45, 73, 106, 149];
const PATTERN_RULES = [60, 90, 102, 105, 110, 150, 154, 165, 182];
const CELL_UNITS = [0.5, 1.6];
const ALPHA = [0.5, 1];
const SEED_ROW_ODDS = 0.55;
const SEED_DENSITY = [0.2, 0.6];

export default {
  id: 'automaton',
  label: 'Автомат',
  grow(ctx, frame, random, palette) {
    const cell = Math.max(2, frame.unit * random.range(CELL_UNITS[0], CELL_UNITS[1]));
    const cols = Math.ceil(frame.width / cell);
    const rows = Math.ceil(frame.height / cell);
    const fromRow = random() < SEED_ROW_ODDS;
    const rule = random.pick(fromRow ? PATTERN_RULES : [...CHAOTIC_RULES, ...PATTERN_RULES]);
    const alpha = random.range(ALPHA[0], ALPHA[1]);
    const ink = random.pick(palette);
    const echo = random.pick(palette);

    const density = random.range(SEED_DENSITY[0], SEED_DENSITY[1]);
    let line = fromRow
      ? Array.from({ length: cols }, () => (random() < density ? 1 : 0))
      : Array.from({ length: cols }, (unused, index) => (index === cols >> 1 ? 1 : 0));

    for (let row = 0; row < rows; row += 1) {
      ctx.fillStyle = rgba(row % 2 ? ink : echo, alpha);
      for (let col = 0; col < cols; col += 1) {
        if (line[col]) ctx.fillRect(col * cell, row * cell, cell, cell);
      }
      // Соседи по кольцу: край продолжается противоположным краем, и полотно не рвётся.
      line = line.map((unused, col) => {
        const left = line[(col - 1 + cols) % cols];
        const self = line[col];
        const right = line[(col + 1) % cols];
        return (rule >> ((left << 2) | (self << 1) | right)) & 1;
      });
    }
  },
};
