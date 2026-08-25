/**
 * Мост к движку PX·77: его источники и деструкторы, вызванные из карточки.
 *
 * Движок (`sources.js`, `degrade.js`, `knobs.js`, `rng.js`) перенесён из my-website как есть
 * и не правится здесь: любая правка на месте разъедется с оригиналом на первом же обновлении
 * сайта. Всё, что нужно карточке или живому выходу, добавляется этим мостом снаружи.
 *
 * Устройство движка в двух словах. Сид даёт не картинку, а набор ручек (`chaosParams`), и
 * ширину разброса этих ручек задаёт `spread`: ноль держит их у ручного центра, единица
 * пускает вразнос. Источник рисует кадр по ручкам, дальше кадр проходит цепочку
 * деструкторов, каждый из которых съедает пиксели и возвращает новые. Деструкторы честно
 * асинхронные: `byte` гоняет кадр через jpeg, `bend` через звуковой движок браузера.
 */

import { chaosParams } from './knobs.js';
import { SOURCES } from './sources.js';
import { DEGRADES } from './degrade.js';
import { LIVE_OPS, LIVE_OP_DEFAULT } from './liveops.js';
import { createMotionEstimator } from './mosh.js';
import { PALETTES } from './palettes.js';

export { PALETTES };

// Насколько источнику разрешено переписывать самого себя. Метка не украшение: аппарат,
// который обещает неожиданность, обязан говорить, откуда она берётся. Ромб значит, что
// машина пишет себе алгоритм сама и никто не знает, что выйдет, пока оно не посчитается.
export const WILDNESS = {
  formula: { mark: '◆', note: 'машина пишет алгоритм сама: каждый сид это другая программа' },
  rules: { mark: '◈', note: 'сид выбирает правила, а не только числа: другая машина, а не другой размер' },
  knobs: { mark: '·', note: 'механика одна и та же, сид двигает её числа' },
};

export const PX_SOURCES = Object.entries(SOURCES).map(([id, source]) => ({
  id,
  label: source.label,
  desc: source.desc,
  wild: source.wild,
}));

// Разложение живого кадра: движение видео тащит картинку, и каждый способ рвёт её по-своему.
export const PX_LIVE_OPS = Object.entries(LIVE_OPS).map(([id, op]) => ({
  id,
  label: op.label,
  desc: op.desc,
}));

export const PX_LIVE_DEFAULT = LIVE_OP_DEFAULT;

/** Один кадр разложения: буфер жуётся полем движения и возвращается новым. */
export const pxDecompose = (id, work, frame, field, opts, state) =>
  LIVE_OPS[id].process(work, frame, field, opts, state);

export const pxMotion = createMotionEstimator;

export const PX_DEGRADES = Object.entries(DEGRADES).map(([id, degrade]) => ({
  id,
  label: degrade.label,
  desc: degrade.desc,
}));

/**
 * Цепочка деструкторов, собранная потоком случайности.
 *
 * Длина цепочки решает почти всё: одно звено читается приёмом, три звена читаются аварией.
 * Опции звена (у линзы это вид и число, у полос ось) тоже бросаются, а не берутся по
 * умолчанию: половина непредсказуемости движка живёт именно в них.
 */
export function pxChain(random, { power, links }) {
  const pool = [...PX_DEGRADES];
  const chain = [];
  for (let step = 0; step < links && pool.length; step += 1) {
    const [taken] = pool.splice(Math.floor(random() * pool.length), 1);
    const options = DEGRADES[taken.id].options ?? {};
    const opts = Object.fromEntries(Object.entries(options).map(([name, option]) => {
      const choices = Object.keys(option.choices);
      return [name, choices[Math.floor(random() * choices.length)]];
    }));
    chain.push({
      id: taken.id,
      amount: (CHAIN_MIN + random() * CHAIN_SPAN) * power,
      opts,
    });
  }
  // Порядок словаря это тракт движка: геометрия, потом цвет, потом кодек. Собранную
  // вразнобой цепочку возвращаем в него, иначе кодек жуёт то, что ещё не искажено.
  return chain.sort((a, b) => order(a.id) - order(b.id));
}

const order = (id) => PX_DEGRADES.findIndex((degrade) => degrade.id === id);

// Сила звена: ниже трети деструктор не виден вовсе, выше трёх четвертей кадр перестаёт
// быть кадром. Ползунок пульта умножает уже этот отрезок.
const CHAIN_MIN = 0.3;
const CHAIN_SPAN = 0.45;

export function pxParams(seed, spread = 0) {
  return chaosParams(String(seed).toUpperCase(), spread);
}

/** Кадр источника по ручкам сида: чистая отрисовка, без единого разрушения. */
export function pxRender(ctx, { width, height, source, params, palette }) {
  SOURCES[source].render(ctx, width, height, params, palette);
}

/**
 * Цепочка деструкторов по готовому кадру.
 *
 * Каждое звено получает целый кадр и возвращает новый, поэтому порядок звеньев это и есть
 * тракт: геометрия, цвет, кодек, сырой буфер. Звено с неизвестным именем пропускается
 * молча: список звеньев приходит из сида, и один переименованный деструктор не должен
 * ронять всю серию афиш.
 */
export async function pxDegrade(ctx, { width, height, params, chain }) {
  for (const link of chain) {
    const degrade = DEGRADES[link.id];
    if (!degrade) continue;
    const eaten = await degrade.apply(
      ctx.getImageData(0, 0, width, height),
      params,
      link.amount,
      link.opts ?? {},
    );
    ctx.putImageData(eaten, 0, 0);
  }
}
