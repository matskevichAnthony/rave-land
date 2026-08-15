import { CAMERA_SPOT_EVENT, createCameraRig } from './camera.js';
import { TYPE_BOX } from './hall.js';
import { createPanel } from '../understav/panel.js';
import { createCanvasRecorder, videoExtension } from '../understav/record.js';
import { createRandom, randomSeed } from '../understav/random.js';
import { isTouchDevice } from '../player/touch-pad.js';
import { FRAME_BUDGET } from './palette.js';

/**
 * Страница промо-сцены AKHET: сборка модулей, пульт, кадрирование и съёмка.
 *
 * Своего тут только зал: пульт, запись, сид, замер и бюджет кадра берутся у страницы
 * UNDERSTAV как есть. Копия этого файла существует потому, что страница съёмки живёт в
 * папке сцены, а не в движке, и её сборка не вынесена в вызываемую функцию.
 */

const MAX_FRAME_DT = 1 / 20;
const SEED_PARAM = 'seed';
const SEED_PATTERN = /^[0-9a-f]{1,8}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const PANEL_KEY = 'KeyH';
const FRAME_MARGIN = 24;

const FRAMINGS = { square: 1, story: 9 / 16, wide: 16 / 9, full: null };

const STATS_WINDOW_SECONDS = 3;
const STATS_REFRESH_SECONDS = 0.25;
const LOW_PERCENTILE = 0.99;

const STILL_MOTION = { speed: 0, turn: 0 };

const WALK_MODE = 'walk';
const EVENT_DATA = 'akhet.json';

// Место под текст выбрано площадкой, поэтому типографике отдаётся коробка из `hall.js`, а
// не вывод из габаритов. Ставит себя монумент сам: он предмет площадки и держит перед
// собой пустой коридор до камеры, а этого коробкой не выразить.
const TYPE_FIT = {
  width: TYPE_BOX.width,
  top: TYPE_BOX.y + TYPE_BOX.height / 2,
  height: TYPE_BOX.height,
};

// Модули сцены грузятся по требованию, а не статическим импортом: упавший или ещё не
// написанный сосед должен дать сообщение на странице, а не чёрный экран без единой строки.
const SCENE_MODULES = [
  { name: 'createStage', file: 'stage.js', load: () => import('./stage.js') },
  { name: 'createArchitecture', file: 'architecture.js', load: () => import('./architecture.js') },
  { name: 'createTypography', file: 'type.js', load: () => import('./type.js') },
  { name: 'createEffects', file: 'effects.js', load: () => import('../understav/effects.js') },
];

const view = { mode: 'still', framing: 'full', countdown: false };

boot().catch(showError);

async function boot() {
  const { createStage, createArchitecture, createTypography, createEffects } = await loadScene();
  const event = await loadEvent();
  const daysLeft = daysUntil(event.date);
  const mount = document.querySelector('[data-js-mount]');

  const stage = createStage({ mount });
  const effects = createEffects({
    renderer: stage.renderer,
    scene: stage.scene,
    camera: stage.camera,
  });
  // Композитор рисует несколько проходов за кадр, а автосброс обнуляет счётчики на каждом
  // из них: без ручного сброса замер показал бы только последний проход.
  stage.renderer.info.autoReset = false;

  const recorder = createCanvasRecorder(stage.renderer.domElement);
  const measure = createMeter(stage.renderer);

  let seed = readSeed(event.seed);
  let world = null;
  let building = 0;
  let takeEndsAt = Infinity;
  let wantsStillFrame = false;
  let walk = null;

  const panel = createPanel({
    root: document.querySelector('[data-js-deck]'),
    opener: document.querySelector('[data-js-deck-toggle]'),
    event,
    budget: FRAME_BUDGET,
    controls: effects.controls,
    view,
    spotEvent: CAMERA_SPOT_EVENT,
    actions: {
      newSeed: () => applySeed(randomSeed()),
      copySeed,
      setMode: (mode) => {
        view.mode = mode;
        if (mode === WALK_MODE) {
          if (isTouchDevice()) panel.hide();
          enterWalk().catch((error) => showNotice(`Прогулка не поднялась: ${error.message}`));
          return;
        }
        walk?.setActive(false);
        world?.rig.setMode(mode);
      },
      setFraming: (framing) => {
        view.framing = framing;
        layout();
      },
      setCountdown: (visible) => {
        view.countdown = visible;
        world?.typography.setDaysLeft(visible ? daysLeft : null);
      },
      guest: addGuest,
      battle: () => {
        if (view.mode !== WALK_MODE || !walk) {
          panel.note('Перестрелка живёт в прогулке');
          return;
        }
        panel.note(walk.toggleBattle() ? 'Перестрелка началась' : 'Перестрелка выключена');
      },
      shoot: startTake,
      capture: () => {
        wantsStillFrame = true;
      },
    },
  });

  panel.showSeed(seed);
  panel.showDays(daysLeft);

  window.addEventListener('resize', layout);
  window.addEventListener('keydown', (domEvent) => {
    if (domEvent.code !== PANEL_KEY) return;
    if (domEvent.target.matches?.('input, select, textarea')) return;
    panel.toggle();
  });

  layout();
  await rebuild();
  runLoop();

  function layout() {
    const { width, height } = frameSize(FRAMINGS[view.framing]);
    mount.style.width = `${width}px`;
    mount.style.height = `${height}px`;
    stage.resize(width, height);
    effects.resize(width, height);
    stage.renderer.domElement.style.width = '100%';
    stage.renderer.domElement.style.height = '100%';
    stage.camera.aspect = width / height;
    stage.camera.updateProjectionMatrix();
  }

  async function rebuild() {
    const ticket = ++building;
    const rng = createRandom(seed);
    const architecture = createArchitecture({ rng });
    const typography = await createTypography({
      event,
      rng,
      bounds: architecture.bounds,
      box: TYPE_FIT,
    });
    if (ticket !== building) {
      disposeGroup(architecture.group);
      disposeGroup(typography.group);
      return;
    }
    clearWorld();
    stage.scene.add(architecture.group, typography.group);
    typography.setDaysLeft(view.countdown ? daysLeft : null);
    const rig = createCameraRig({
      camera: stage.camera,
      bounds: architecture.bounds,
      rng,
      poster: typography.group,
    });
    rig.setMode(view.mode);
    world = { architecture, typography, rig };
  }

  function clearWorld() {
    if (!world) return;
    for (const part of [world.architecture, world.typography]) {
      stage.scene.remove(part.group);
      disposeGroup(part.group);
    }
    world = null;
  }

  async function enterWalk() {
    if (!walk) {
      panel.note('Поднимаю физику');
      const { createWalk } = await import('./walk.js').catch((error) => {
        throw new Error(`walk.js не загрузился: ${error.message}`);
      });
      walk = await createWalk({
        scene: stage.scene,
        camera: stage.camera,
        renderer: stage.renderer,
        grab: document.querySelector('[data-js-walk-grab]'),
        cast: event.cast,
      });
    }
    // Пока грузилась физика, режим могли переключить: тогда персонажу в кадре не место.
    if (view.mode !== WALK_MODE) return;
    walk.setActive(true);
    panel.note('Прогулка: щёлкни по кадру и иди');
  }

  /** Гость это возможность движка, а не сцены: население приходит из данных события. */
  async function addGuest() {
    if (view.mode !== WALK_MODE || !walk) {
      panel.note('Гости ходят только в прогулке');
      return;
    }
    try {
      panel.note(`Гость ${await walk.addGuest()} в зале`);
    } catch (error) {
      panel.note(`Гость не пришёл: ${error.message}`);
    }
  }

  function applySeed(next) {
    seed = next;
    const url = new URL(window.location.href);
    url.searchParams.set(SEED_PARAM, seed);
    window.history.replaceState(null, '', url);
    panel.showSeed(seed);
    panel.note(`Сид ${seed}: собираю сцену`);
    rebuild().then(() => panel.note(`Сид ${seed}`)).catch(showError);
  }

  async function copySeed() {
    try {
      await navigator.clipboard.writeText(seed);
      panel.note(`Сид ${seed} скопирован`);
    } catch (error) {
      panel.note(`Скопировать не вышло: ${error.message}`);
    }
  }

  function startTake(seconds) {
    if (recorder.recording) return;
    try {
      recorder.start();
    } catch (error) {
      panel.note(`Запись не пошла: ${error.message}`);
      return;
    }
    takeEndsAt = performance.now() + seconds * 1000;
    panel.setRecording(true);
    panel.note(`Пишу ${seconds} с`);
  }

  async function finishTake() {
    takeEndsAt = Infinity;
    try {
      const blob = await recorder.stop();
      const name = `${fileStem()}.${videoExtension(blob)}`;
      download(blob, name);
      panel.note(`Готово: ${name}`);
    } catch (error) {
      panel.note(`Запись сорвалась: ${error.message}`);
    }
    panel.setRecording(false);
  }

  function saveStillFrame() {
    stage.renderer.domElement.toBlob((blob) => {
      if (!blob) {
        panel.note('Кадр не снялся: холст пуст');
        return;
      }
      const name = `${fileStem()}.png`;
      download(blob, name);
      panel.note(`Готово: ${name}`);
    }, 'image/png');
  }

  function fileStem() {
    return `${event.event}-${view.mode}-${seed}`.toLowerCase();
  }

  function runLoop() {
    let previous = performance.now();
    let elapsed = 0;
    stage.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min((now - previous) / 1000, MAX_FRAME_DT);
      previous = now;
      elapsed += dt;
      try {
        drawFrame(dt, elapsed);
      } catch (error) {
        stage.renderer.setAnimationLoop(null);
        showError(error);
      }
    });
  }

  function drawFrame(dt, elapsed) {
    stage.renderer.info.reset();
    stage.update(dt, elapsed);
    world?.architecture.update(elapsed);
    world?.typography.update(dt, elapsed);
    const walking = view.mode === WALK_MODE && walk !== null;
    if (walking) walk.update(dt);
    else world?.rig.update(dt, elapsed);
    effects.render(dt, elapsed, world && !walking ? world.rig.motion : STILL_MOTION);

    if (recorder.recording) recorder.frame();
    if (wantsStillFrame) {
      wantsStillFrame = false;
      saveStillFrame();
    }
    if (performance.now() >= takeEndsAt) finishTake();

    const measured = measure(dt);
    if (measured) panel.showStats(measured);
  }
}

async function loadScene() {
  const parts = await Promise.all(SCENE_MODULES.map(async ({ name, file, load }) => {
    const module = await load().catch((error) => {
      throw new Error(`${file} не загрузился: ${error.message}`);
    });
    if (typeof module[name] !== 'function') throw new Error(`${file} без выхода ${name}`);
    return [name, module[name]];
  }));
  return Object.fromEntries(parts);
}

async function loadEvent() {
  const response = await fetch(EVENT_DATA);
  if (!response.ok) throw new Error(`${EVENT_DATA} не отдался: ${response.status}`);
  const event = await response.json();
  if (!event?.event || !event?.date || !Array.isArray(event.lineup)) {
    throw new Error(`${EVENT_DATA} без события, даты или лайнапа`);
  }
  return event;
}

function daysUntil(date) {
  const target = Date.parse(`${date}T00:00:00`);
  if (Number.isNaN(target)) throw new Error(`дата события не читается: ${date}`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((target - today.getTime()) / DAY_MS));
}

function readSeed(fallback) {
  const asked = new URL(window.location.href).searchParams.get(SEED_PARAM);
  return asked && SEED_PATTERN.test(asked) ? asked.toLowerCase() : fallback;
}

function frameSize(aspect) {
  if (!aspect) return { width: window.innerWidth, height: window.innerHeight };
  const boxWidth = Math.max(window.innerWidth - FRAME_MARGIN * 2, 1);
  const boxHeight = Math.max(window.innerHeight - FRAME_MARGIN * 2, 1);
  const width = Math.round(Math.min(boxWidth, boxHeight * aspect));
  return { width, height: Math.round(width / aspect) };
}

function disposeGroup(group) {
  group.traverse((node) => {
    node.geometry?.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) material?.dispose();
  });
}

function download(blob, name) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Замер кадра: средний и худший из последних секунд, плюс счётчики отрисовки. */
function createMeter(renderer) {
  const frames = [];
  let span = 0;
  let sinceReport = 0;
  return function measure(dt) {
    frames.push(dt);
    span += dt;
    while (span > STATS_WINDOW_SECONDS && frames.length > 1) span -= frames.shift();
    sinceReport += dt;
    if (sinceReport < STATS_REFRESH_SECONDS) return null;
    sinceReport = 0;
    const sorted = [...frames].sort((first, second) => first - second);
    const low = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * LOW_PERCENTILE))];
    return {
      fps: frames.length / Math.max(span, dt),
      worstMs: low * 1000,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    };
  };
}

function showNotice(text) {
  const box = document.querySelector('[data-js-error]');
  box.textContent = text;
  box.hidden = false;
}

function showError(error) {
  showNotice(`Сцена не собралась: ${error.message}`);
}
