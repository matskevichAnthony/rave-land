/**
 * Автопилот: инструмент играет сам, когда за пультом никого нет.
 *
 * Устроен на одном допущении: у нас нет контроллера и не будет, поэтому единственное, что
 * приходит снаружи, это импульс. Автопилот их считает и на счёте принимает решения. Это не
 * украшение, а способ попасть в музыку: смена, случившаяся на четвёртом ударе, читается как
 * часть трека, та же смена посреди такта читается как сбой программы.
 *
 * Решения разложены по длине фразы, и это главное правило файла. На четырёх ударах меняется
 * мелочь, приём разгрома, на восьми способ наложения, на шестнадцати приём разложения и
 * бросок машины, на тридцати двух палитра, на шестидесяти четырёх источник целиком. На
 * больших числах совпадают все делители сразу, поэтому раз в шестьдесят четыре удара
 * меняется всё разом, и это слышно как приход. Ровности мешает бросок кости у каждого хода:
 * автопилот, отбивающий смену метрономом, за десять минут становится предсказуемым.
 *
 * Громкость решает не когда, а что: на тихом месте ходы снимают разгром, на громком
 * добавляют. Сет от этого дышит, а не растёт в одну сторону до полной каши.
 *
 * Тишина автопилот не останавливает. Без звука он бьёт себе такт сам, потому что «сам по
 * себе играет» означает и «играет, когда музыку выключили», иначе экран в перерыве замирает.
 */

import { MACHINE_OPS, MACHINE_PALETTES, MACHINE_SOURCES } from './machine.js';
import { BLENDS } from '../procedural/blend.js';
import { MANGLES } from './mangle.js';

// Ход: на каком делении фразы случается и с какой охотой. Порядок от мелкого к крупному,
// он же порядок применения на общем делении.
const MOVES = [
  { kind: 'mangle', every: 4, odds: 0.65 },
  { kind: 'blend', every: 8, odds: 0.5 },
  { kind: 'op', every: 16, odds: 0.8 },
  { kind: 'roll', every: 16, odds: 1 },
  { kind: 'palette', every: 32, odds: 0.7 },
  { kind: 'source', every: 64, odds: 1 },
];

// Темп перемен растягивает или сжимает все деления разом: слева фраза вдвое длиннее, справа
// вдвое короче. Одним ползунком, потому что руки за пультом нет и крутить его будут редко.
const PACE_SLOW = 2;
const PACE_FAST = 0.5;

// Своя доля такта, когда импульсов нет вовсе: чуть медленнее ста двадцати ударов в минуту.
const IDLE_BEAT_MS = 520;

// Громко и тихо для выбора хода: выше первого разгром прибывает, ниже второго убывает.
const LOUD = 0.45;
const QUIET = 0.18;

// Сколько приёмов разгрома автопилот держит включёнными: ниже нижнего кадр становится
// пустым, выше верхнего перестаёт читаться вовсе.
const MANGLE_RANGE = [1, 4];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const pickId = (list) => pick(list).id;

const LABELS = {
  mangle: 'разгром',
  blend: 'наложение',
  op: 'разложение',
  roll: 'бросок',
  palette: 'палитра',
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
  return { kind };
}

export function createAutopilot() {
  let beats = 0;
  let beatAt = 0;

  return {
    get beats() {
      return beats;
    },
    /**
     * Кадр автопилота: считает импульс и возвращает ходы, которые пора сделать.
     *
     * Импульс приходит либо от звука, либо от собственного такта. Дальше он только число:
     * автопилоту всё равно, слышит инструмент зал или играет в тишине.
     */
    tick({ hit, level, pace, mangles, now }) {
      const beat = hit || now - beatAt > IDLE_BEAT_MS;
      if (!beat) return [];
      beatAt = now;
      beats += 1;

      const stretch = PACE_SLOW + (PACE_FAST - PACE_SLOW) * pace;
      return MOVES
        .filter(({ every, odds }) => {
          const step = Math.max(1, Math.round(every * stretch));
          return beats % step === 0 && Math.random() < odds;
        })
        .map(({ kind }) => decide(kind, { mangles, level }))
        .filter(Boolean);
    },
    reset() {
      beats = 0;
    },
  };
}

/** Строка для пульта: что автопилот только что сделал и на каком ударе. */
export const moveLine = (moves, beats) =>
  `${beats} · ${moves.map(({ kind }) => LABELS[kind]).join(', ')}`;
