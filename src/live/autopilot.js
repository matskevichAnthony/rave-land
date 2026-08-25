/**
 * Автопилот: инструмент играет сам, когда за пультом никого нет.
 *
 * Устроен на одном допущении: у нас нет контроллера и не будет, поэтому единственное, что
 * приходит снаружи, это удары, и решения принимаются на их счёте. Это не украшение, а способ
 * попасть в музыку: смена, случившаяся на четвёртом ударе, читается как часть трека, та же
 * смена посреди такта читается как сбой программы.
 *
 * Решения разложены по длине фразы, и это главное правило файла. Через удар в кадр входит
 * новое тело, на четырёх меняется приём разгрома, на восьми способ наложения, на шестнадцати
 * приём разложения, бросок машины и форма тел, на тридцати двух палитра, искажение и ливень,
 * на шестидесяти четырёх источник целиком и сила трипа. На больших числах совпадают все делители сразу,
 * поэтому раз в шестьдесят четыре удара меняется всё разом, и это слышно как приход.
 * Ровности мешает бросок кости у каждого хода: автопилот, отбивающий смену метрономом, за
 * десять минут становится предсказуемым.
 *
 * Громкость решает не когда, а что: на тихом месте ходы снимают разгром, на громком
 * добавляют. Сет от этого дышит, а не растёт в одну сторону до полной каши.
 *
 * Своего счёта здесь нет. Удары считает и дорисовывает такт в `beat.js`, сюда приходит их
 * номер, и на нём принимается решение. Поэтому тишина автопилот не останавливает: «играет
 * сам» означает и «играет, когда музыку выключили», иначе экран в перерыве замирает.
 */

import { MACHINE_OPS, MACHINE_PALETTES, MACHINE_SOURCES } from './machine.js';
import { BLENDS } from '../procedural/blend.js';
import { MANGLES } from './mangle.js';
import { SHAPES } from './space/bodies.js';
import { WARPS } from './space/warp.js';

// Ход: на каком делении фразы случается и с какой охотой. Порядок от мелкого к крупному,
// он же порядок применения на общем делении. Ходы с пометкой `volume` живут в объёмном
// слое и отпадают сами, когда слой снят.
const MOVES = [
  { kind: 'spawn', every: 2, odds: 0.5, volume: true },
  { kind: 'mangle', every: 4, odds: 0.65 },
  { kind: 'blend', every: 8, odds: 0.5 },
  { kind: 'op', every: 16, odds: 0.8 },
  { kind: 'roll', every: 16, odds: 1 },
  { kind: 'shape', every: 16, odds: 0.5, volume: true },
  { kind: 'palette', every: 32, odds: 0.7 },
  { kind: 'warp', every: 32, odds: 0.7, volume: true },
  { kind: 'rain', every: 32, odds: 0.5, volume: true },
  { kind: 'trip', every: 64, odds: 0.6, volume: true },
  { kind: 'source', every: 64, odds: 1 },
];

// Темп перемен растягивает или сжимает все деления разом: слева фраза вдвое длиннее, справа
// вдвое короче. Одним ползунком, потому что руки за пультом нет и крутить его будут редко.
const PACE_SLOW = 2;
const PACE_FAST = 0.5;

// Громко и тихо для выбора хода: выше первого разгром прибывает, ниже второго убывает.
const LOUD = 0.45;
const QUIET = 0.18;

// Сколько приёмов разгрома автопилот держит включёнными: ниже нижнего кадр становится
// пустым, выше верхнего перестаёт читаться вовсе.
const MANGLE_RANGE = [1, 4];

// Плотность ливня, между которой автопилот выбирает. Ноль в наборе обязателен: слой, идущий
// весь сет без перерыва, перестаёт читаться приёмом и становится фоном, который глаз снимает
// с экрана через минуту.
const RAIN_STEPS = [0, 0.15, 0.3, 0.55];

// Сила трипа, между которой автопилот выбирает. Нуля здесь нет: эхо и врезки это не приём
// поверх картинки, а то, чем слой держит зал, и снимать их целиком на середине сета значит
// уронить выход в плоскую витрину. Меняется он реже всего, раз в шестьдесят четыре удара,
// потому что смена глубины кадра читается как смена места, а не как ход.
const TRIP_STEPS = [0.25, 0.45, 0.7, 1];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const pickId = (list) => pick(list).id;

const LABELS = {
  spawn: 'тело',
  mangle: 'разгром',
  blend: 'наложение',
  op: 'разложение',
  roll: 'бросок',
  shape: 'форма',
  palette: 'палитра',
  warp: 'искажение',
  rain: 'ливень',
  trip: 'трип',
  source: 'источник',
};

/**
 * Ход разгрома: чем громче, тем охотнее прибавляет, но края набора держатся всегда.
 *
 * Неизвестная громкость это не тишина. Со снятым слухом инструмент играет вслепую, и если
 * считать вслепую за тихо, автопилот будет вечно снимать разгром и держать пустой кадр.
 * Поэтому там, где громкости нет, ход бросает кость.
 */
function mangleMove(mangles, energy) {
  const level = energy ?? Math.random();
  const on = MANGLES.filter(({ id }) => mangles.has(id));
  const off = MANGLES.filter(({ id }) => !mangles.has(id));
  const add = on.length < MANGLE_RANGE[0] ? true
    : on.length >= MANGLE_RANGE[1] ? false
      : level > LOUD ? true
        : level < QUIET ? false
          : Math.random() < 0.5;
  const list = add ? off : on;
  if (!list.length) return null;
  return { kind: 'mangle', value: pickId(list), on: add };
}

function decide(kind, { mangles, level }) {
  if (kind === 'mangle') return mangleMove(mangles, level);
  if (kind === 'blend') return { kind, value: pickId(BLENDS) };
  if (kind === 'op') return { kind, value: pickId(MACHINE_OPS) };
  if (kind === 'palette') return { kind, value: pickId(MACHINE_PALETTES) };
  if (kind === 'source') return { kind, value: pickId(MACHINE_SOURCES) };
  if (kind === 'shape') return { kind, value: pickId(SHAPES) };
  if (kind === 'warp') return { kind, value: pickId(WARPS) };
  if (kind === 'rain') return { kind, value: pick(RAIN_STEPS) };
  if (kind === 'trip') return { kind, value: pick(TRIP_STEPS) };
  return { kind };
}

/**
 * Ходы, которые пора сделать на этом ударе.
 *
 * Счёт ударов приходит снаружи, потому что такт держит не автопилот: удары считаются и
 * дорисовываются в одном месте на весь инструмент, иначе слои разъезжаются по разным тактам.
 * Здесь остаётся только решение, а решение это чистая функция от номера удара.
 */
export function movesFor({ beat, level, pace, mangles, volume }) {
  const stretch = PACE_SLOW + (PACE_FAST - PACE_SLOW) * pace;
  return MOVES
    .filter((move) => volume || !move.volume)
    .filter(({ every, odds }) => {
      const step = Math.max(1, Math.round(every * stretch));
      return beat % step === 0 && Math.random() < odds;
    })
    .map(({ kind }) => decide(kind, { mangles, level }))
    .filter(Boolean);
}

/** Строка для пульта: что автопилот только что сделал и на каком ударе. */
export const moveLine = (moves, beat) =>
  `${beat} · ${moves.map(({ kind }) => LABELS[kind]).join(', ')}`;
