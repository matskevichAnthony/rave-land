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
 *
 * Всё это плоское, и всё это теперь не выход, а материал. Поверх стопки лежит второй холст,
 * объёмный, и он включён с самого начала. Готовый плоский кадр уходит на видеокарту
 * текстурой, там ведётся по кривой сетке, натягивается на тела, которые рождаются, летят на
 * камеру, перетекают из формы в форму и умирают сами, и уезжает в эхо-тоннель из самого себя.
 * Плоская стопка при этом цела до последнего приёма: объём показывает её, а не заменяет, и
 * снимается одной кнопкой, оставляя ровно тот инструмент, что был.
 *
 * Удары считает такт, а не слух, и планку удара не ставит никто. Слух меряет, какой прирост
 * в этом зале обычен, и ударом считает вышедший за обычный, отдельно по бочке, телу и верху;
 * такт держит счёт дальше, дорисовывая пропущенное. Весь инструмент живёт по этому счёту: на
 * нём стоят ходы автопилота, срок жизни тел и мутация машины. Поэтому и пауза в зале, и стук
 * по столу вместо музыки больше не решают, что видит зал.
 */

import { makeInks, DEFAULT_HOT, DEFAULT_COLD } from '../cards/ink.js';
import { DEFAULT_BLEND } from '../procedural/blend.js';
import { moveLine, movesFor } from './autopilot.js';
import { createBeat } from './beat.js';
import { createDeck } from './deck.js';
import { createListening } from './listen.js';
import {
  DEFAULT_OP, DEFAULT_PALETTE, DEFAULT_SOURCE, createMachine,
} from './machine.js';
import { createMangle } from './mangle.js';
import { DEFAULT_PLACE, createOverlay } from './overlay.js';
import { createSource } from './source.js';
import { DEFAULT_SHAPE } from './space/bodies.js';
import { DEFAULT_WARP } from './space/warp.js';
import { createSpace } from './space/stage.js';

const SILENCE = {
  level: 0, low: 0, mid: 0, high: 0, hit: false, rise: 0, raw: 0,
  punchAt: 1, kick: 0, snare: 0, hat: 0, tempo: 0, confidence: 0,
};
const RATE_WINDOW_MS = 500;
const HIDE_KEY = 'h';
const FULL_KEY = 'f';
const ROLL_KEY = ' ';
const BODY_KEY = 'b';

// Холст объёма лежит поверх плоского и включается классом: снимать его из потока значило бы
// пересоздавать контекст видеокарты на каждое нажатие кнопки.
const SPACE_ON_CLASS = 'is-on';

// Звук машине: даже в тишине разложение продолжается, иначе картинка на паузе между
// треками читается как зависшая программа.
const IDLE_DRIVE = 0.3;

// Сколько тел объёмный слой держит на полном ползунке. Дальше растёт не картинка, а
// счётчик кадров вниз: каждое тело это свой проход по экрану.
const ROOM_MAX = 20;

// Потолок честных пикселей экрана. Холст, посчитанный в CSS-пикселях, на плотном экране
// растягивается в два раза, и мылит на этом весь кадр, даже когда источник пришёл чистым.
// Дальше полутора плотность стоит вчетверо дороже, а проектор эту разницу уже не показывает.
const PIXEL_CAP = 1.5;

// Потолок шага между кадрами. Свёрнутая вкладка отдаёт первый кадр после возврата с
// секундным шагом, и тела за него улетают из кадра целиком.
const STEP_CAP = 0.05;

const stage = document.querySelector('[data-js-stage]');
const ctx = stage.getContext('2d', { alpha: false });
const source = createSource();
const listening = createListening();
const beat = createBeat();
const overlay = createOverlay();
const spaceCanvas = document.querySelector('[data-js-space]');
const space = createSpace({ canvas: spaceCanvas, frame: stage });

const view = {
  source: null,
  ear: 'off',
  // Шкала громкости руками: где кончается фон комнаты и где начинается громко. Начальные
  // числа сняты с комнаты, а не с зала: домашние колонки в микрофон ноутбука дают доли шкалы,
  // и человек, который первым делом видит мёртвую картинку, закрывает вкладку, а не ищет
  // ползунок. В клубе шкала уезжает вверх рукой за пять секунд.
  quiet: 0.05,
  loud: 0.45,
  // Импульс это не планка, а строгость: планку слух выводит из зала сам, а ползунок двигает
  // её выше или ниже найденной. Середина работает и дома, и в клубе, поэтому она и стоит.
  punch: 0.3,
  auto: false,
  pace: 0.5,
  // Объём: второй холст поверх первого, и он же теперь главный выход. Плоская стопка из
  // машины, разложения и разгрома осталась целиком, но она стала тем, что объём показывает,
  // а не тем, что видит зал: кадр уходит на видеокарту и живёт там телами, морфом и
  // искажением. Снять слой можно кнопкой, под ним ровно прежний инструмент.
  space: {
    on: true,
    warp: DEFAULT_WARP,
    shape: DEFAULT_SHAPE,
    amount: 0.5,
    morph: 0.45,
    glass: 0.5,
    crowd: 0.35,
    // Ливень знаков идёт сдержанно: густой он читается заставкой поверх видео, а всё дело
    // в том, чтобы он читался рябью самого кадра.
    rain: 0.25,
    // Трип поднят сразу, но не до края: эхо и врезки это то, ради чего слой и делался, а
    // полная ручка на первом же кадре не оставляет запаса, куда расти к приходу.
    trip: 0.4,
  },
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
  // Честные пиксели по умолчанию: жалоба на мыло приходит раньше, чем жалоба на кадры, а
  // ползунок плотности стоит на пульте рядом со счётчиком и убирается рукой за секунду.
  density: 1,
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
let frameAt = 0;
let mutateAt = 0;
// Последняя услышанная громкость: руке за пультом она нужна там же, где автопилоту, а
// читать её заново ради одной кнопки незачем.
let level = 0;

const seed = () => crypto.getRandomValues(new Uint32Array(1))[0].toString(16).toUpperCase();

/**
 * Размер вывода: пиксели считаются от окна и плотности, а не от экрана.
 *
 * Проектор в зале почти всегда мылит сильнее, чем разница между честными пикселями и
 * тремя четвертями, а кадр за эти четверти платит вдвое. Ползунок оставлен человеку:
 * на слабом ноутбуке он уводит плотность вниз и доигрывает сет, а не перезапускает браузер.
 */
function fit() {
  const pixels = Math.min(window.devicePixelRatio || 1, PIXEL_CAP) * view.density;
  const width = Math.round(window.innerWidth * pixels);
  const height = Math.round(window.innerHeight * pixels);
  if (stage.width === width && stage.height === height) return;
  stage.width = width;
  stage.height = height;
  // Размер холста сбрасывает настройки его контекста, поэтому качество пересчёта ставится
  // здесь же: кадр источника почти всегда меньше холста, и растягивает его именно эта ручка.
  ctx.imageSmoothingQuality = 'high';
  mangle = createMangle(width, height);
  space.setSize(width, height);
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

/** Сколько тел объёмный слой держит при нынешнем ползунке. */
const roomSize = () => Math.max(1, Math.round(view.space.crowd * ROOM_MAX));

/**
 * Автопилот: на ударе он решает, что менять, и ходы применяются к виду.
 *
 * Пульт от этого не отключается: человек может вмешаться в любой момент, и следующий ход
 * автопилота просто ляжет поверх. Ходы, требующие пересчёта кадра, идут через ту же дверь,
 * что и руки, поэтому бросок машины у них общий и второго пути к нему нет.
 */
function fly(level) {
  if (!view.auto) return;
  const moves = movesFor({
    beat: beat.count,
    // Снятый слух это не тишина, а неизвестность: автопилот решает сам, чем её заполнить.
    level: view.ear === 'off' ? null : level,
    pace: view.pace,
    mangles: view.mangles,
    volume: view.space.on,
  });
  if (!moves.length) return;
  for (const move of moves) apply(move, level);
  deck.note(moveLine(moves, beat.count));
  deck.showState(view);
}

/** Один ход автопилота на вид: словарь вместо лестницы условий, ход это данные. */
function apply(move, level) {
  const moves = {
    spawn: () => space.spawn({ room: roomSize(), level }),
    mangle: () => (move.on ? view.mangles.add(move.value) : view.mangles.delete(move.value)),
    blend: () => Object.assign(view.machine, { blend: move.value }),
    op: () => { view.machine.op = move.value; machine.setOp(move.value); },
    shape: () => { view.space.shape = move.value; space.setShape(move.value); },
    palette: () => { view.machine.palette = move.value; roll(); },
    warp: () => { view.space.warp = move.value; space.setWarp(move.value); },
    rain: () => { view.space.rain = move.value; space.setRain(move.value); },
    trip: () => { view.space.trip = move.value; space.setTrip(move.value); },
    source: () => { view.machine.source = move.value; roll(); },
    roll,
  };
  moves[move.kind]();
}

/** Мутация: каждые столько ударов машина бросается заново и картинка меняется на бочку. */
function mutate() {
  if (!view.machine.mutate) return;
  mutateAt += 1;
  if (mutateAt < view.machine.mutate) return;
  mutateAt = 0;
  roll();
}

/**
 * Кадр инструмента.
 *
 * Порядок здесь и есть стопка слоёв: сначала звук, следом решения такта, следом двумерный
 * кадр, и только потом объём, которому этот кадр нужен готовым. Объём считается лишь когда
 * включён: снятый слой не стоит ни кадра, и это единственный способ вернуть шестьдесят
 * кадров на слабой машине, не трогая остальных ручек.
 */
function tick(now) {
  requestAnimationFrame(tick);
  fit();
  const dt = Math.min(STEP_CAP, (now - frameAt) / 1000);
  frameAt = now;
  const pulse = view.ear === 'off' ? SILENCE : listening.read({
    quiet: view.quiet,
    loud: view.loud,
    punch: view.punch,
    now,
  });
  level = pulse.level;

  if (beat.tick({ hit: pulse.hit, now, tempo: pulse.tempo, confidence: pulse.confidence })) {
    space.age();
    fly(pulse.level);
    mutate();
  }

  paint(pulse);
  if (view.space.on) {
    space.render({
      dt,
      time: now / 1000,
      level: pulse.level,
      low: pulse.low,
      mid: pulse.mid,
      high: pulse.high,
      punched: pulse.hit,
      kick: pulse.kick,
      snare: pulse.snare,
      hat: pulse.hat,
      warp: view.space.amount,
      morph: view.space.morph,
      glass: view.space.glass,
      rain: view.space.rain,
      trip: view.space.trip,
    });
  }

  frames += 1;
  if (now - rateAt >= RATE_WINDOW_MS) {
    fps = Math.round((frames * 1000) / (now - rateAt));
    frames = 0;
    rateAt = now;
  }
  deck.showPulse({
    level: pulse.level,
    raw: pulse.raw,
    rise: pulse.rise,
    hit: pulse.hit,
    punchAt: pulse.punchAt,
    scale: { quiet: view.quiet, loud: view.loud },
    fps,
    bpm: beat.bpm,
    heard: beat.heard,
    bodies: space.count,
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
    setQuiet: (quiet) => { view.quiet = quiet; },
    setLoud: (loud) => { view.loud = loud; },
    setPunch: (punch) => { view.punch = punch; },
    toggleAuto: () => {
      view.auto = !view.auto;
      beat.reset();
      deck.note(view.auto
        ? 'Автопилот: считает импульсы и решает сам, руки при этом не заперты'
        : 'Автопилот снят');
      deck.showState(view);
    },
    setPace: (pace) => { view.pace = pace; },
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
    toggleSpace: () => {
      view.space.on = !view.space.on;
      spaceCanvas.classList.toggle(SPACE_ON_CLASS, view.space.on);
      // Снятый слой не должен возвращаться с прежним составом тел: за время без него
      // сет ушёл, и старые тела читались бы обрывком чужого куска.
      if (!view.space.on) space.clear();
      deck.note(view.space.on
        ? 'Объём: кадр ушёл на тела и в искажение, автопилот получил ещё три хода'
        : 'Объём снят, остался плоский кадр');
      deck.showState(view);
    },
    setWarp: (id) => { view.space.warp = id; space.setWarp(id); deck.showState(view); },
    setShape: (id) => { view.space.shape = id; space.setShape(id); deck.showState(view); },
    setWarpAmount: (amount) => { view.space.amount = amount; },
    setMorph: (morph) => { view.space.morph = morph; },
    setGlass: (glass) => { view.space.glass = glass; },
    setRain: (rain) => { view.space.rain = rain; space.setRain(rain); },
    setTrip: (trip) => { view.space.trip = trip; space.setTrip(trip); },
    setCrowd: (crowd) => { view.space.crowd = crowd; deck.showState(view); },
    throwBody: () => space.spawn({ room: roomSize(), level }),
    clearBodies: () => space.clear(),
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
  if (press.key === BODY_KEY && view.space.on) space.spawn({ room: roomSize(), level });
  if (press.key === ROLL_KEY) {
    press.preventDefault();
    roll();
  }
});

fit();
spaceCanvas.classList.toggle(SPACE_ON_CLASS, view.space.on);
space.setRain(view.space.rain);
space.setTrip(view.space.trip);
roll();
deck.showState(view);
deck.note('Пробел бросает машину заново. Ютуб идёт кнопкой «Вкладка»: браузер спросит, чем поделиться');
requestAnimationFrame(tick);
