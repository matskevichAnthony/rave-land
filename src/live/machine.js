/**
 * Машина: картинка PX·77 и её живое разложение.
 *
 * Это не поле и не эффект, это отдельный слой со своей жизнью, устроенный так же, как
 * оригинальный аппарат на matzkaim.ru/px, и по той же причине. Источник PX считается долго
 * и в кадр не влезает: тринадцать алгоритмов, среди которых мутант, где машина пишет себе
 * программу сама, стоят от десятков миллисекунд до секунды. Поэтому картинка рисуется один
 * раз и живёт дальше не перерисовкой, а разложением: каждый кадр её жуёт один из пяти
 * приёмов, и жуёт не абы как, а по полю движения, снятому с видео. Что шевелится в кадре
 * источника, то и рвёт картинку.
 *
 * Отсюда слойность, которой не даст ни одно поле: снизу видео, поверх машина со своим
 * наложением, лого можно вжечь прямо в её кадр, и тогда оно разлагается вместе с ней, а не
 * висит наклейкой. Разложение накапливается: буфер кормится собственным выходом, и порыв
 * компаундится кадр за кадром, как поток, потерявший опорный кадр.
 *
 * Буфер меньше экрана и растягивается на выводе. Приёмы разложения работают по пикселям на
 * процессоре, и это единственное место инструмента, где размер буфера решает, будет ли
 * шестьдесят кадров. Проектор в зале мылит сильнее любой растяжки.
 *
 * Без видео машина не встаёт: у приёмов внутри свой генератор дрейфа на случай неподвижной
 * подачи, и картинка продолжает разлагаться сама по себе, только медленнее и ровнее.
 */

import {
  PALETTES, PX_LIVE_DEFAULT, PX_LIVE_OPS, PX_SOURCES,
  pxChain, pxDecompose, pxDegrade, pxMotion, pxParams, pxRender,
} from '../px/paint.js';

export const MACHINE_SOURCES = PX_SOURCES;
export const MACHINE_OPS = PX_LIVE_OPS;
export const MACHINE_PALETTES = Object.entries(PALETTES).map(([id, { label }]) => ({ id, label }));

export const DEFAULT_SOURCE = 'flow';
export const DEFAULT_OP = PX_LIVE_DEFAULT;
export const DEFAULT_PALETTE = 'mono';

const MACHINE_WIDTH = 640;
const FEED_WIDTH = 384;

// Поле движения, когда видео нет: приёмы читают его каждый кадр и без него стоят. Сетка
// любая, лишь бы приёмы могли по ней ходить.
const IDLE_GRID = { w: 16, h: 9 };

// Собственный дрейф: медленный вихрь вместо снятого движения. Доля кадра за кадр здесь та
// же, которую движок считает полным движением, поэтому «машина сама» и «машина от видео»
// рвут картинку с одинаковой силой, а не в разы по-разному.
const DRIFT_REF = 0.02;
const DRIFT_IDLE = 0.35;
const DRIFT_SPEED = 0.012;
const DRIFT_SPAN = 0.7;

// Длина цепочки деструкторов на один бросок картинки. Одно звено читается приёмом, три
// звена читаются аварией, дальше от исходника не остаётся ничего.
const WRECK_LINKS = 3;

function buffer(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}

/**
 * Дрейф вместо снятого движения.
 *
 * Приёмы разложения написаны под живую подачу: часть из них умеет крутить себя сама, когда
 * подача замерла, а часть, включая тот, что стоит по умолчанию, без поля движения просто
 * стоит. Пустое поле означало бы, что инструмент без видео показывает неподвижную картинку
 * и выглядит сломанным. Поэтому здесь считается вихрь: он идёт сам, ускоряется от звука и
 * уступает место настоящему движению, как только появляется источник.
 */
function createDrift() {
  const cells = IDLE_GRID.w * IDLE_GRID.h;
  const field = {
    gridW: IDLE_GRID.w,
    gridH: IDLE_GRID.h,
    vx: new Float32Array(cells),
    vy: new Float32Array(cells),
  };
  let phase = 0;

  return (level) => {
    phase += DRIFT_SPEED;
    const amplitude = DRIFT_REF * (DRIFT_IDLE + level * (1 - DRIFT_IDLE));
    for (let row = 0; row < IDLE_GRID.h; row += 1) {
      for (let column = 0; column < IDLE_GRID.w; column += 1) {
        const cell = row * IDLE_GRID.w + column;
        field.vx[cell] = Math.sin(phase + row * DRIFT_SPAN) * amplitude;
        field.vy[cell] = Math.cos(phase * 0.8 + column * DRIFT_SPAN) * amplitude;
      }
    }
    return field;
  };
}

export function createMachine(ratio) {
  const width = MACHINE_WIDTH;
  const height = Math.max(2, Math.round(MACHINE_WIDTH / ratio));
  const picture = buffer(width, height);
  // Бросок считается в своём буфере и переезжает в картинку целиком: деструкторы честно
  // асинхронные, и два броска, начатые подряд, иначе жевали бы кадр друг друга.
  const scratch = buffer(width, height);
  const feed = buffer(FEED_WIDTH, 2);
  const estimator = pxMotion({ width, height });
  const drift = createDrift();

  let work = null;
  let previous = null;
  let opState = {};
  let opId = DEFAULT_OP;
  let rollToken = 0;
  let busy = false;

  /** Кадр подачи в маленьком буфере: оценщику движения больше и не нужно. */
  function feedFrame(video) {
    if (!video?.videoWidth) return null;
    const tall = Math.max(2, Math.round((video.videoHeight / video.videoWidth) * FEED_WIDTH));
    if (feed.canvas.height !== tall) feed.canvas.height = tall;
    feed.ctx.drawImage(video, 0, 0, FEED_WIDTH, tall);
    return feed.ctx.getImageData(0, 0, FEED_WIDTH, tall);
  }

  return {
    canvas: picture.canvas,
    get busy() {
      return busy;
    },

    /**
     * Бросок картинки: источник считается заново и, если просят, проходит цепочку
     * деструкторов движка.
     *
     * Считается это долго и асинхронно, а руки за пультом быстрее: токен роняет любой
     * просчёт, чьи настройки уже успели смениться. Пока новый кадр не готов, разложение
     * продолжает жевать старый, и смена настроек не читается как «всё умерло».
     *
     * `stamp` рисует поверх готового кадра до того, как он уйдёт в разложение: этим лого
     * вжигается в машину и разваливается вместе с ней.
     */
    async roll({ source, seed, spread, palette, wreck, stamp }) {
      const token = ++rollToken;
      busy = true;
      const params = pxParams(seed, spread);
      pxRender(scratch.ctx, { width, height, source, params, palette: PALETTES[palette] });
      if (wreck > 0) {
        await pxDegrade(scratch.ctx, {
          width,
          height,
          params,
          chain: pxChain(Math.random, { power: wreck, links: WRECK_LINKS }),
        });
      }
      if (token !== rollToken) return;
      stamp?.(scratch.ctx, { width, height });
      picture.ctx.drawImage(scratch.canvas, 0, 0);
      work = picture.ctx.getImageData(0, 0, width, height);
      previous = null;
      opState = {};
      busy = false;
    },

    /** Смена приёма разложения: у каждого своя память, и чужая ему только мешает. */
    setOp(next) {
      if (next === opId) return;
      opId = next;
      opState = {};
    },

    /**
     * Кадр разложения.
     *
     * Сила это ползунок, умноженный на звук: ползунок задаёт потолок, звук решает, добираем
     * ли до него сейчас. Подмес подачи гасится в ноль, когда видео нет: иначе приём
     * подмешивал бы в картинку пустой чёрный буфер и просто гасил её. Без видео поле
     * движения даёт собственный дрейф, и картинка продолжает разлагаться.
     */
    step({ video, strength, blend, level }) {
      if (!work) return;
      const next = feedFrame(video);
      const field = next && previous ? estimator.estimate(previous, next) : drift(level);
      work = pxDecompose(opId, work, next ?? work, field, {
        estimator,
        strength,
        blend: next ? blend : 0,
      }, opState);
      picture.ctx.putImageData(work, 0, 0);
      previous = next;
    },
  };
}
