/**
 * Живой выход: видео из любого источника, генеративное поле поверх и разгром по звуку.
 *
 * Инструмент для вечеринки, а не для рендера: здесь нет сида, нет повторяемости и нет
 * выгрузки. Всё, что происходит на экране, происходит один раз, и единственное, что
 * действительно важно, это чтобы кадр не проседал под руками, поэтому счётчик кадров висит
 * прямо на пульте, а разрешение вывода отдано ползунком человеку за пультом.
 *
 * Слои идут снизу вверх: кадр источника, поле выбранным способом наложения, разгром поверх
 * всего. Порядок не случайный. Поле под разгромом рвётся вместе с картинкой и читается её
 * частью, а поверх разгрома оно легло бы наклейкой и выдало бы, что это две разные вещи.
 */

import { makeInks, DEFAULT_HOT, DEFAULT_COLD } from '../cards/ink.js';
import { createDeck } from './deck.js';
import { createField, DEFAULT_FIELD } from './field.js';
import { DEFAULT_BLEND } from './blend.js';
import { createListening } from './listen.js';
import { createMangle } from './mangle.js';
import { createSource } from './source.js';

const SILENCE = { level: 0, low: 0, mid: 0, high: 0, hit: false };
const RATE_WINDOW_MS = 500;
const HIDE_KEY = 'h';
const FULL_KEY = 'f';

const stage = document.querySelector('[data-js-stage]');
const ctx = stage.getContext('2d', { alpha: false });
const source = createSource();
const listening = createListening();

const view = {
  source: null,
  ear: 'off',
  threshold: 0.16,
  field: DEFAULT_FIELD,
  blend: DEFAULT_BLEND,
  alpha: 0.72,
  speed: 0.5,
  power: 0.5,
  density: 0.75,
  mangles: new Set(),
  hot: DEFAULT_HOT,
  cold: DEFAULT_COLD,
  showVideo: true,
  freeze: false,
};

let field = null;
let mangle = null;
let frames = 0;
let rateAt = 0;
let fps = 0;

/**
 * Размер вывода: пиксели считаются от окна и плотности, а не от экрана.
 *
 * Проектор в зале почти всегда мылит сильнее, чем разница между честными пикселями и
 * тремя четвертями, а кадр за эти четверти платит вдвое. Ползунок оставлен человеку:
 * на слабом ноутбуке он уводит плотность вниз и доигрывает сет, а не перезапускает браузер.
 */
function fit() {
  const width = Math.round(window.innerWidth * view.density);
  const height = Math.round(window.innerHeight * view.density);
  if (stage.width === width && stage.height === height) return;
  stage.width = width;
  stage.height = height;
  field = createField(width / height);
  mangle = createMangle(width, height);
}

/** Кадр источника во весь экран без искажения пропорций: лишнее уходит за край. */
function drawCover() {
  const { video } = source;
  const ratio = video.videoWidth / video.videoHeight;
  const wide = ratio > stage.width / stage.height;
  const width = wide ? stage.height * ratio : stage.width;
  const height = wide ? stage.height : stage.width / ratio;
  ctx.drawImage(video, (stage.width - width) / 2, (stage.height - height) / 2, width, height);
}

function paint(pulse) {
  const inks = makeInks({ hot: view.hot, cold: view.cold });
  if (!view.freeze) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = inks.void;
    ctx.fillRect(0, 0, stage.width, stage.height);
    if (view.showVideo && source.ready) drawCover();
  }

  const painted = field.draw({
    kind: view.field,
    palette: [inks.ember, inks.moon, inks.flame, inks.trip, inks.bone, inks.blood],
    speed: view.speed,
    level: pulse.level,
    alpha: view.alpha,
    hit: pulse.hit,
  });
  ctx.save();
  ctx.globalCompositeOperation = view.blend;
  ctx.drawImage(painted, 0, 0, stage.width, stage.height);
  ctx.restore();

  mangle.apply(ctx, { width: stage.width, height: stage.height }, {
    on: view.mangles,
    power: view.power,
    level: pulse.level,
    hit: pulse.hit,
  });
}

function tick(now) {
  requestAnimationFrame(tick);
  fit();
  const pulse = view.ear === 'off' ? SILENCE : listening.read({ threshold: view.threshold, now });
  paint(pulse);

  frames += 1;
  if (now - rateAt >= RATE_WINDOW_MS) {
    fps = Math.round((frames * 1000) / (now - rateAt));
    frames = 0;
    rateAt = now;
  }
  deck.showPulse({ level: pulse.level, hit: pulse.hit, fps });
}

/** Всё, что просит разрешения у браузера, отвечает отказом человеку, а не молчанием. */
async function tryOut(what, run) {
  try {
    await run();
  } catch (error) {
    deck.note(`${what}: ${error.message}`);
  }
}

async function openSource(kind, open) {
  await tryOut('Источник', async () => {
    const opened = await open();
    view.source = kind;
    deck.note(opened.hasAudio ? 'Источник со звуком: можно слушать его' : 'Источник без звука');
    // Слух уже был наведён на прежний источник, и после подмены он слушает пустоту.
    if (view.ear === 'source') await listening.source({ stream: opened.stream, video: source.video });
    deck.showState(view);
  });
}

const deck = createDeck({
  root: document.querySelector('[data-js-deck]'),
  view,
  actions: {
    setSource: (kind) => {
      if (kind === 'display') openSource(kind, source.display);
      if (kind === 'camera') openSource(kind, source.camera);
      if (kind === 'file') document.querySelector('[data-js-file]').click();
      if (kind === 'url') document.querySelector('[data-js-url]').focus();
    },
    openFile: (file) => openSource('file', () => source.file(file)),
    openUrl: (address) => address && openSource('url', () => source.url(address)),
    setEar: (ear) => tryOut('Слух', async () => {
      if (ear === 'microphone') await listening.microphone();
      if (ear === 'source') await listening.source({ stream: source.stream, video: source.video });
      if (ear === 'off') listening.off();
      view.ear = ear;
      deck.showState(view);
    }),
    setThreshold: (threshold) => { view.threshold = threshold; },
    setField: (kind) => { view.field = kind; deck.showState(view); },
    setBlend: (blend) => { view.blend = blend; deck.showState(view); },
    setAlpha: (alpha) => { view.alpha = alpha; },
    setSpeed: (speed) => { view.speed = speed; },
    setPower: (power) => { view.power = power; },
    setDensity: (density) => { view.density = density; },
    toggleMangle: (id) => {
      if (view.mangles.has(id)) view.mangles.delete(id);
      else view.mangles.add(id);
      deck.showState(view);
    },
    setInks: (hot, cold) => { view.hot = hot; view.cold = cold; },
    toggleVideo: () => { view.showVideo = !view.showVideo; deck.showState(view); },
    toggleFreeze: () => { view.freeze = !view.freeze; deck.showState(view); },
    goFullscreen: () => document.documentElement.requestFullscreen(),
  },
});

// Файл кидают на страницу, а не ищут в диалоге: за минуту до выхода это разные вещи.
document.addEventListener('dragover', (drag) => drag.preventDefault());
document.addEventListener('drop', (drop) => {
  drop.preventDefault();
  const file = drop.dataTransfer.files[0];
  if (file) openSource('file', () => source.file(file));
});

// Пульт снимается с экрана клавишей: в зале проектор показывает то же окно, и пульт в кадре
// это пульт на стене клуба.
document.addEventListener('keydown', (press) => {
  if (press.target.matches('input')) return;
  if (press.key === HIDE_KEY) document.body.classList.toggle('is-bare');
  if (press.key === FULL_KEY) document.documentElement.requestFullscreen();
});

deck.showState(view);
deck.note('Ютуб идёт кнопкой «Вкладка»: браузер спросит, чем поделиться, и отдаст звук вкладки');
requestAnimationFrame(tick);
