/**
 * Генеративные семейства мутанта: по файлу на систему, список один на проект.
 *
 * Семейство это не «ещё один фон», а отдельный способ вырастить изображение: клеточный
 * автомат, реакция-диффузия, плитки Труше, интерференция линий, рекурсивный раскол. У всех
 * одно общее свойство и оно тут главное: рисунок кадра не задан руками, а выведен из правила,
 * поэтому увидеть результат можно только просчитав его.
 *
 * Добавили файл и строку в список, и семейство участвует в раздаче. Никаких вторых списков
 * в направлении нет.
 */

import automaton from './automaton.js';
import blocks from './blocks.js';
import contour from './contour.js';
import diffusion from './diffusion.js';
import flow from './flow.js';
import moire from './moire.js';
import rings from './rings.js';
import shatter from './shatter.js';
import strata from './strata.js';
import truchet from './truchet.js';

export const GROWTHS = [
  contour, flow, blocks, rings, automaton, truchet, moire, shatter, strata, diffusion,
];

/**
 * Перестановка семейств на серию.
 *
 * Раньше каждая карточка бросала себе семейство сама и из двух возможных, поэтому в серии
 * из шести половина карточек выходила одинаковой по устройству. Теперь серийный поток
 * тасует весь список один раз, а карточка берёт своё место в колоде по номеру: шесть афиш
 * получают шесть разных систем, а сид фона меняет, кому какая досталась.
 */
export function growthOrder(random) {
  const order = [...GROWTHS];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = random.int(0, index);
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}
