/**
 * Живой выход: видео из любого источника, машина PX·77 поверх, своя картинка в стопке и
 * разгром по звуку.
 *
 * Инструмент для вечеринки, а не для рендера: здесь нет повторяемости и нет выгрузки. Всё,
 * что происходит на экране, происходит один раз, и единственное, что действительно важно,
 * это чтобы кадр не проседал под руками, поэтому счётчик кадров висит прямо на пульте, а
 * разрешение вывода отдано ползунком человеку за пультом.
 *
 * Стопка снизу вверх: кадр источника, своя картинка под машиной, машина выбранным способом
 * наложения, своя картинка поверх машины, разгром поверх всего. Порядок не случайный.
 * Машина под разгромом рвётся вместе с картинкой и читается её частью, а поверх разгрома
 * легла бы наклейкой и выдала бы, что это две разные вещи. Своя картинка имеет три места, и
 * среднее из них не место вовсе: оттуда она вжигается внутрь кадра машины и разлагается
 * вместе с ним.
 *
 * Звук раздаётся по слоям без общего множителя: машине он даёт силу разложения, картинке
 * удар, разгрому потолок. Один ползунок на всё звучал бы одинаково во всех трёх местах, а
 * они и должны отвечать по-разному.
 */

import { makeInks, DEFAULT_HOT, DEFAULT_COLD } from '../cards/ink.js';
import { DEFAULT_BLEND } from '../procedural/blend.js';
import { createDeck } from './deck.js';
import { createListening } from './listen.js';
import {
  DEFAULT_OP, DEFAULT_PALETTE, DEFAULT_SOURCE, createMachine,
} from './machine.js';
import { createMangle } from './mangle.js';
import { DEFAULT_PLACE, createOverlay } from './overlay.js';
import { createSource } from './source.js';

const SILENCE = { level: 0, low: 0, mid: 0, high: 0, hit: false, ready: false, span: 0 };
const RATE_WINDOW_MS = 500;
const HIDE_KEY = 'h';
const FULL_KEY = 'f';
const ROLL_KEY = ' ';

// Звук машине: даже в тишине разложение продолжается, иначе картинка на паузе между
// треками читается как зависшая программа.
const IDLE_DRIVE = 0.3;

const stage = document.querySelector('[data-js-stage]');
const ctx = stage.getContext('2d', { alpha: false });
const source = createSource();
const listening = createListening();
const overlay = createOverlay();

const view = {
  source: null,
  ear: 'off',
  trim: 0,
  machine: {
    source: DEFAULT_SOURCE,
    palette: DEFAULT_PALETTE,
    spread: 0.55,
    wreck: 0,
    op: DEFAULT_OP,
    strength: 0.6,
    feed: 0.4,
    blend: DEFAULT_BLEND,
    alpha: 0.85,
    mutate: 0,
  },
  overlay: {
    place: DEFAULT_PLACE,
    blend: 'source-over',
    scale: 0.4,
    alpha: 1,
    tint: false,
  },
  power: 0.5,
  density: 0.75,
  mangles: new Set(),
  hot: DEFAULT_HOT,
  cold: DEFAULT_COLD,
  showVideo: true,
  freeze: false,
};

let machine = null;
let mangle = null;
let frames = 0;
let rateAt = 0;
let fps = 0;
let beats = 0;

const seed = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase();

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
  mangle = createMangle(width, height);
  const before = machine;
  machine = createMachine(width / height);
  if (before) roll();
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

const inkOf = () => makeInks({ hot: view.hot, cold: view.cold });

/** Бросок машины: новый сид, новый кадр, при месте «в машину» с вожжённой картинкой. */
function roll() {
  const set = view.machine;
  const burn = view.overlay.place === 'burn';
  machine.roll({
    source: set.source,
    seed: seed(),
    spread: set.spread,
    palette: set.palette,
    wreck: set.wreck,
    stamp: burn ? (into, size) => overlay.draw(into, size, {
      scale: view.overlay.scale,
      alpha: view.overlay.alpha,
      blend: view.overlay.blend,
      hex: view.overlay.tint ? inkOf().ember : null,
    }) : null,
  }).catch((error) => deck.note(`Машина: ${error.message}`));
}

function paint(pulse) {
  const inks = inkOf();
  const set = view.machine;
  const size = { width: stage.width, height: stage.height };

  if (!view.freeze) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = inks.void;
    ctx.fillRect(0, 0, stage.width, stage.height);
    if (view.showVideo && source.ready) drawCover();
  }

  overlay.pulse(pulse.hit);
  const ink = view.overlay.tint ? inks.ember : null;
  const paintOverlay = (place) => {
    if (view.overlay.place !== place) return;
    overlay.draw(ctx, size, {
      scale: view.overlay.scale,
      alpha: view.overlay.alpha,
      blend: view.overlay.blend,
      hex: ink,
    });
  };

  paintOverlay('under');

  machine.step({
    video: view.showVideo && source.ready ? source.video : null,
    strength: set.strength * (IDLE_DRIVE + pulse.level * (1 - IDLE_DRIVE)),
    blend: set.feed,
    level: pulse.level,
  });
  ctx.save();
  ctx.globalCompositeOperation = set.blend;
  ctx.globalAlpha = set.alpha;
  ctx.drawImage(machine.canvas, 0, 0, stage.width, stage.height);
  ctx.restore();

  paintOverlay('over');

  mangle.apply(ctx, size, {
    on: view.mangles,
    power: view.power,
    level: pulse.level,
    hit: pulse.hit,
  });
}

/** Мутация: каждые столько ударов машина бросается заново и картинка меняется на бочку. */
function mutate(hit) {
  if (!hit || !view.machine.mutate) return;
  beats += 1;
  if (beats < view.machine.mutate) return;
  beats = 0;
  roll();
}

function tick(now) {
  requestAnimationFrame(tick);
  fit();
  const pulse = view.ear === 'off' ? SILENCE : listening.read({ trim: view.trim, now });
  mutate(pulse.hit);
  paint(pulse);

  frames += 1;
  if (now - rateAt >= RATE_WINDOW_MS) {
    fps = Math.round((frames * 1000) / (now - rateAt));
    frames = 0;
    rateAt = now;
  }
  deck.showPulse({
    level: pulse.level,
    hit: pulse.hit,
    // Метка калибровки касается только включённого слуха: в тишине мерять нечего.
    measuring: view.ear !== 'off' && !pulse.ready,
    fps,
  });
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

/** Правка настройки машины: часть настроек требует пересчёта кадра, часть читается сразу. */
function setMachine(change, again = false) {
  Object.assign(view.machine, change);
  if (change.op) machine.setOp(change.op);
  if (again) roll();
  deck.showState(view);
}

async function openOverlayFile(file) {
  await tryOut('Картинка', async () => {
    await overlay.open(file);
    setOverlay({});
    deck.note('Картинка в стопке: место решает, рвать её или беречь');
  });
}

function setOverlay(change) {
  Object.assign(view.overlay, change);
  // Вожжённая картинка живёт внутри кадра машины, и поменять её можно только новым броском.
  if (view.overlay.place === 'burn') roll();
  deck.showState(view);
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
      deck.note(ear === 'off' ? 'Слух выключен' : 'Слух меряет зал: пара секунд, и шкала растянется по нему');
      deck.showState(view);
    }),
    setTrim: (trim) => { view.trim = trim; },
    setMachineSource: (id) => setMachine({ source: id }, true),
    setPalette: (id) => setMachine({ palette: id }, true),
    setSpread: (spread) => setMachine({ spread }, true),
    setWreck: (wreck) => setMachine({ wreck }, true),
    setOp: (op) => setMachine({ op }),
    setStrength: (strength) => setMachine({ strength }),
    setFeed: (feed) => setMachine({ feed }),
    setMachineBlend: (blend) => setMachine({ blend }),
    setAlpha: (alpha) => setMachine({ alpha }),
    setMutate: (mutate) => setMachine({ mutate }),
    roll,
    pickOverlay: () => document.querySelector('[data-js-overlay-file]').click(),
    openOverlay: openOverlayFile,
    dropOverlay: () => {
      overlay.drop();
      setOverlay({});
    },
    setOverlayPlace: (place) => setOverlay({ place }),
    setOverlayBlend: (blend) => setOverlay({ blend }),
    setOverlayScale: (scale) => setOverlay({ scale }),
    setOverlayAlpha: (alpha) => setOverlay({ alpha }),
    toggleOverlayTint: () => setOverlay({ tint: !view.overlay.tint }),
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
// Картинка ложится слоем, видео становится источником: разбирается по типу файла.
document.addEventListener('dragover', (drag) => drag.preventDefault());
document.addEventListener('drop', (drop) => {
  drop.preventDefault();
  const file = drop.dataTransfer.files[0];
  if (!file) return;
  if (file.type.startsWith('image/')) openOverlayFile(file);
  else openSource('file', () => source.file(file));
});

// Пульт снимается с экрана клавишей: в зале проектор показывает то же окно, и пульт в кадре
// это пульт на стене клуба. Пробел бросает машину заново: это самая частая рука за сет.
document.addEventListener('keydown', (press) => {
  if (press.target.matches('input')) return;
  if (press.key === HIDE_KEY) document.body.classList.toggle('is-bare');
  if (press.key === FULL_KEY) document.documentElement.requestFullscreen();
  if (press.key === ROLL_KEY) {
    press.preventDefault();
    roll();
  }
});

fit();
roll();
deck.showState(view);
deck.note('Пробел бросает машину заново. Ютуб идёт кнопкой «Вкладка»: браузер спросит, чем поделиться');
requestAnimationFrame(tick);
