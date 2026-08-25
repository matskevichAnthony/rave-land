/**
 * Разрушение живого кадра: то, чем играют руками во время сета.
 *
 * Приёмы те же, что громят афишу в `cards/chaos.js`, но переписаны под кадр в секунду
 * шестьдесят: никакой попиксельной арифметики и никаких новых холстов в цикле. Всё, что
 * здесь есть, это `drawImage` кадра в самого себя и заливки поверх, то есть работа
 * видеокарты, а не процессора.
 *
 * Снимок кадра на все приёмы один. Каждый приём снимал его себе сам, и семь включённых
 * приёмов копировали полный экран семь раз за кадр: на честных 1920×1080 это половина
 * бюджета кадра, потраченная на копирование одной и той же картинки. Плата за общий снимок
 * в том, что приёмы читают кадр до разгрома, а не результат соседа; на глаз это заметно
 * только у эха, и оно от этого чище.
 *
 * Случайность здесь честно живая: афиша обязана повторяться по сиду, а сет обязан не
 * повторяться, поэтому единственное место в проекте, где `Math.random` уместен, это оно.
 *
 * Сила каждого приёма это ползунок, умноженный на звук. Ползунок задаёт потолок, звук
 * решает, добираем ли мы до него сейчас: на тихом месте кадр почти цел, на бочке разваливается.
 */

const MOSH_BANDS = [6, 22];
const MOSH_THROW = 0.16;

const SMEAR_COLUMNS = [2, 7];
const SMEAR_WIDTH = [0.01, 0.06];

const ECHO_SHIFT = 0.02;
const ECHO_SCALE = 0.03;
const ECHO_ALPHA = 0.45;

const CHROMA_SHIFT = 0.012;
const CHANNELS = [['#ff0000', -1], ['#00b3ff', 1]];
// Канальные копии живут в половинном буфере: окраска умножением стоит по пикселю, и на
// честном экране этот приём один съедал столько же, сколько все остальные вместе. Мыло
// внутри сдвинутого канала не читается: его перекрывает резкий кадр под ним.
const CHROMA_SCALE = 0.5;

const INVERT_BANDS = [1, 4];
const INVERT_HEIGHT = [0.02, 0.14];

const SCAN_STEP = 3;
const SCAN_ALPHA = 0.45;

const SHAKE_THROW = 0.03;

const between = (min, max) => min + Math.random() * (max - min);
const count = (range, power) => Math.max(1, Math.round(between(range[0], range[1]) * power));

/** Полосы кадра съезжают вбок: самый узнаваемый приём порванного видео. */
function mosh(ctx, { width, height }, { shot }, power) {
  const bands = count(MOSH_BANDS, power);
  const band = height / bands;
  for (let index = 0; index < bands; index += 1) {
    const shift = between(-1, 1) * width * MOSH_THROW * power;
    ctx.drawImage(
      shot.canvas,
      0, index * band, width, band,
      shift, index * band, width, band,
    );
  }
}

/** Размаз: узкая колонка кадра растягивается вниз до самого края. */
function smear(ctx, { width, height }, { shot }, power) {
  for (let index = 0; index < count(SMEAR_COLUMNS, power); index += 1) {
    const span = width * between(SMEAR_WIDTH[0], SMEAR_WIDTH[1]);
    const x = between(0, width - span);
    const y = between(0, height * 0.8);
    ctx.drawImage(shot.canvas, x, y, span, 2, x, y, span, height - y);
  }
}

/** Эхо: кадр наступает сам на себя со сдвигом и лёгким наездом, как затянувшийся шлейф. */
function echo(ctx, { width, height }, { shot }, power) {
  const grow = 1 + ECHO_SCALE * power;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = ECHO_ALPHA * power;
  ctx.drawImage(
    shot.canvas,
    (width - width * grow) / 2 + between(-1, 1) * width * ECHO_SHIFT * power,
    (height - height * grow) / 2,
    width * grow,
    height * grow,
  );
  ctx.restore();
}

/**
 * Разъезд каналов: жар уходит влево, холод вправо, кадр двоится цветом, а не формой.
 *
 * Канал красится вторым буфером, а не общим снимком: снимок нужен соседним приёмам целым,
 * а умножение на красный испортило бы его им всем.
 */
function chroma(ctx, { width, height }, { shot, tint, mix }, power) {
  const shift = width * CHROMA_SHIFT * power * CHROMA_SCALE;
  mix.ctx.globalCompositeOperation = 'source-over';
  mix.ctx.fillStyle = '#000000';
  mix.ctx.fillRect(0, 0, mix.canvas.width, mix.canvas.height);
  for (const [channel, direction] of CHANNELS) {
    tint.ctx.globalCompositeOperation = 'source-over';
    tint.ctx.drawImage(shot.canvas, 0, 0, tint.canvas.width, tint.canvas.height);
    tint.ctx.globalCompositeOperation = 'multiply';
    tint.ctx.fillStyle = channel;
    tint.ctx.fillRect(0, 0, tint.canvas.width, tint.canvas.height);
    mix.ctx.globalCompositeOperation = 'lighter';
    mix.ctx.drawImage(tint.canvas, shift * direction, 0);
  }
  // Оба канала складываются в половинном буфере и ложатся на кадр одним проходом: на
  // честном экране каждый лишний проход со сложением стоит дороже всей остальной работы.
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(mix.canvas, 0, 0, width, height);
  ctx.restore();
}

/** Негативные полосы: кусок кадра выворачивается наизнанку прямо на месте. */
function invert(ctx, { width, height }, shop, power) {
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#ffffff';
  for (let index = 0; index < count(INVERT_BANDS, power); index += 1) {
    const band = height * between(INVERT_HEIGHT[0], INVERT_HEIGHT[1]);
    ctx.fillRect(0, between(0, height - band), width, band);
  }
  ctx.restore();
}

/** Развёртка: тёмные строки через равный шаг, кадр как с уставшего монитора. */
function scan(ctx, { width, height }, shop, power) {
  ctx.save();
  ctx.fillStyle = `rgba(0, 0, 0, ${SCAN_ALPHA * power})`;
  for (let y = 0; y < height; y += SCAN_STEP * 2) ctx.fillRect(0, y, width, SCAN_STEP);
  ctx.restore();
}

/** Тряска: весь кадр подпрыгивает. Единственный приём, которому нужен именно удар. */
function shake(ctx, { width, height }, { shot }, power) {
  ctx.drawImage(
    shot.canvas,
    between(-1, 1) * width * SHAKE_THROW * power,
    between(-1, 1) * height * SHAKE_THROW * power,
  );
}

// Порядок словаря это порядок наложения: сначала геометрия, потом цвет, тряска последней.
// В обратном порядке негативные полосы разъезжались бы вместе с кадром и читались мусором.
const TOOLS = { mosh, smear, echo, chroma, invert, scan, shake };

export const MANGLES = [
  { id: 'mosh', label: 'Мош' },
  { id: 'smear', label: 'Размаз' },
  { id: 'echo', label: 'Эхо' },
  { id: 'chroma', label: 'Каналы' },
  { id: 'invert', label: 'Негатив' },
  { id: 'scan', label: 'Развёртка' },
  { id: 'shake', label: 'Тряска' },
];

// Приёмы, которые бьют по удару, а не непрерывно: между ударами кадр от них свободен.
const ON_HIT = new Set(['shake', 'invert']);

// Кому нужен снимок кадра: заливки и негатив работают прямо по экрану, и ради них копию
// снимать незачем.
const NEEDS_SHOT = new Set(['mosh', 'smear', 'echo', 'chroma', 'shake']);

function buffer(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d', { alpha: false }) };
}

export function createMangle(width, height) {
  const half = [Math.round(width * CHROMA_SCALE), Math.round(height * CHROMA_SCALE)];
  const shop = { shot: buffer(width, height), tint: buffer(...half), mix: buffer(...half) };

  return {
    /** Проход всех включённых приёмов по кадру: сила общая, звук решает, добираем ли до неё. */
    apply(ctx, view, { on, power, level, hit }) {
      const tools = MANGLES.filter(({ id }) => on.has(id) && (hit || !ON_HIT.has(id)));
      if (!tools.length) return;
      if (tools.some(({ id }) => NEEDS_SHOT.has(id))) shop.shot.ctx.drawImage(ctx.canvas, 0, 0);
      const strength = power * (0.25 + level * 0.75);
      for (const { id } of tools) {
        TOOLS[id](ctx, view, shop, ON_HIT.has(id) ? power : strength);
      }
    },
  };
}
