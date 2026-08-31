import { createBats } from './bats.js';
import { createCameraRig } from './camera.js';
import { createPanel } from './panel.js';
import { createCanvasRecorder, videoExtension } from './record.js';
import { createRandom, randomSeed } from './random.js';
import { isTouchDevice } from '../player/touch-pad.js';
import { FRAME_BUDGET } from './palette.js';
import { NAVE } from './nave.js';

/**
 * Страница промо-сцены UNDERSTAV: сборка модулей, пульт, кадрирование и съёмка.
 *
 * Кадрирование живёт до отрисовки, а не после: холст физически меняет размер, поэтому
 * в вертикальном кадре видно ровно то, что попадёт в файл.
 */

const MAX_FRAME_DT = 1 / 20;
const SEED_PARAM = 'seed';
const SEED_PATTERN = /^[0-9a-f]{1,8}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const PANEL_KEY = 'KeyH';
const FRAME_MARGIN = 24;
const MEGABYTE = 1024 * 1024;
const MEGABIT = 1000 * 1000;

const FRAMINGS = { square: 1, story: 9 / 16, wide: 16 / 9, sheet: 1 / Math.SQRT2, full: null };

// Кадр это то, что видно на экране, фото это тот же кадр, снятый крупно: холст на один раз
// уплотняется до этой высоты. Под печать высота другая: триста точек на дюйм по длинной
// стороне листа A4.
const PHOTO = { height: 2160, printHeight: 3508 };

// Дубль пишется с холста, поэтому разрешение файла это плотность холста, поднятая на время
// записи: окно остаётся тем же, а в файл уходит кадр во столько раз крупнее. Ноль это «как
// на экране», остальное — высота кадра в точках.
const TAKE_HEIGHTS = { screen: 0, fhd: 1080, uhd: 2160 };

// Потолок плотности стоит ради памяти: мишени постобработки живут в полукадрах с плавающей
// точкой, и вчетверо плотнее холста их поднимать уже нечем.
const MAX_DENSITY = 4;

/**
 * Печатный вид: то же самое, но снятое так, чтобы пережило бумагу и мессенджер.
 *
 * Разрушение, зерно и хроматика рассчитаны на светящийся экран и движение. На неподвижном
 * снимке они читаются грязью, а сжатие в мессенджере доедает остальное. Виньетка уходит
 * в ноль: на экране она собирает кадр, на светлом фоне листа съедает углы. Расфокус уходит
 * следом, потому что на листе решает резкость, а не глубина; свечение и тень в стыках
 * остаются, но тише экранных: бумага не светится и добирает контраст сама.
 */
const PRINT_KNOBS = {
  ao: 0.7,
  dof: 0,
  mosh: 0,
  ghost: 0,
  chroma: 0,
  melt: 0,
  grain: 0,
  bloom: 0.35,
  vignette: 0,
};

const STATS_WINDOW_SECONDS = 3;
const STATS_REFRESH_SECONDS = 0.25;
const LOW_PERCENTILE = 0.99;

const STILL_MOTION = { speed: 0, turn: 0 };

// Прогулку ведёт свой модуль от первого лица, и цели взгляда у неё нет: фокус стоит на
// середине зала. Наведённый в упор, он размыл бы ровно то, по чему идут.
const WALK_FOCUS_METRES = (NAVE.frontZ - NAVE.endZ) / 2;

// Прогулка тянет за собой физику и модель игрока, поэтому её модуль грузится не раньше
// первого входа в режим: кадр афиши снимается без Rapier.
const WALK_MODE = 'walk';

// Модули сцены грузятся по требованию, а не статическим импортом: упавший или ещё не
// написанный сосед должен дать сообщение на странице, а не чёрный экран без единой строки.
const SCENE_MODULES = [
  { name: 'createStage', file: 'stage.js', load: () => import('./stage.js') },
  { name: 'createArchitecture', file: 'architecture.js', load: () => import('./architecture.js') },
  { name: 'createTypography', file: 'type.js', load: () => import('./type.js') },
  { name: 'createEffects', file: 'effects.js', load: () => import('./effects.js') },
];

// Страница открывается печатным видом: афишу отсюда уносят картинкой, а не смотрят как
// заставку, и первый же кадр обязан быть тем, что уйдёт в файл. Экранный вид со всей грязью
// движения остаётся под тем же переключателем в одном щелчке.
const view = {
  mode: 'still', framing: 'full', countdown: false, poster: true, print: true,
  flat: false, fov: null, quality: 'screen',
};

boot().catch(showError);

async function boot() {
  const { createStage, createArchitecture, createTypography, createEffects } = await loadScene();
  const event = await loadEvent();
  const daysLeft = daysUntil(event.date);
  const mount = document.querySelector('[data-js-mount]');

  const stage = createStage({ mount });
  // Угол объектива спрашивается у камеры, а не выписывается вторым числом рядом: значение по
  // умолчанию живёт в `stage.js`, и пульт обязан стартовать с того же, с чем стартовала сцена.
  view.fov = stage.camera.fov;
  // Плоский набор висит на камере, а дети камеры рисуются только если камера в графе сцены.
  stage.scene.add(stage.camera);
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
  let canvasDensity = 0;
  let wantsStillFrame = false;
  let wantsPhoto = false;
  let screenKnobs = null;
  let walk = null;

  const panel = createPanel({
    root: document.querySelector('[data-js-deck]'),
    opener: document.querySelector('[data-js-deck-toggle]'),
    event,
    budget: FRAME_BUDGET,
    controls: effects.controls,
    view,
    actions: {
      newSeed: () => applySeed(randomSeed()),
      copySeed,
      setMode: (mode) => {
        view.mode = mode;
        if (mode === WALK_MODE) {
          // На телефоне пульт лежит нижним листом ровно там, где стик и кнопки, поэтому на
          // входе в прогулку он сворачивается: вернуть его можно кнопкой в углу. Признак
          // сенсора берётся у самого пада, иначе пульт свернётся там, где пада не будет.
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
      setQuality: (quality) => {
        view.quality = quality;
        const wanted = TAKE_HEIGHTS[quality];
        panel.note(wanted ? `Дубль: ${wanted} точек по высоте` : 'Дубль: как на экране');
      },
      setCountdown: (visible) => {
        view.countdown = visible;
        world?.typography.setDaysLeft(visible ? daysLeft : null);
      },
      // Афиша прячется целиком группой: зал снимают и без текста, а собирать сцену заново
      // ради этого нечего, буквы никуда не делись и вернутся тем же переключателем.
      setPoster: (visible) => {
        view.poster = visible;
        if (!world) return;
        world.typography.group.visible = visible;
        world.architecture.setPoster(visible);
      },
      setFov: (degrees) => {
        view.fov = degrees;
        stage.camera.fov = degrees;
        stage.camera.updateProjectionMatrix();
        world?.typography.refitFlat(stage.camera);
      },
      setFlat: (active) => {
        view.flat = active;
        world?.typography.setFlat(active, stage.camera);
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
      setPrint: (active) => {
        usePrint(active);
        panel.note(active ? 'Печатный вид: разрушение выключено' : 'Экранный вид');
      },
      // Снимок меняет размер холста, а дорожка записи смены размера не переживает.
      photo: () => {
        if (recorder.recording) {
          panel.note('Фото ждёт конца дубля');
          return;
        }
        wantsPhoto = true;
      },
      saveScene: saveSceneFile,
    },
  });

  panel.showSeed(seed);
  panel.showDays(daysLeft);
  usePrint(view.print);

  // Обработчику события первым доводом приходит само событие, а `layout` ждёт плотность:
  // передать его напрямую значит попросить холст размером с объект Event.
  window.addEventListener('resize', () => layout());
  window.addEventListener('keydown', (domEvent) => {
    if (domEvent.code !== PANEL_KEY) return;
    if (domEvent.target.matches?.('input, select, textarea')) return;
    panel.toggle();
  });

  layout();
  await rebuild();
  runLoop();

  /**
   * Размер кадра на экране и плотность его холста.
   *
   * Плотность живёт дольше одного вызова: дубль держит её весь отрезок, а окно за это время
   * могут потянуть, и пересборка по событию обязана вернуть плотность дубля, а не экранную.
   */
  function layout(density = canvasDensity) {
    const { width, height } = frameSize(FRAMINGS[view.framing]);
    mount.style.width = `${width}px`;
    mount.style.height = `${height}px`;
    stage.resize(width, height, density);
    effects.resize(width, height);
    // Холст тянется по рамке кадра: свой размер в пикселях он мог поставить по-своему.
    stage.renderer.domElement.style.width = '100%';
    stage.renderer.domElement.style.height = '100%';
    stage.camera.aspect = width / height;
    stage.camera.updateProjectionMatrix();
    world?.typography.refitFlat(stage.camera);
  }

  async function rebuild() {
    const ticket = ++building;
    const rng = createRandom(seed);
    const architecture = await createArchitecture({ rng });
    const typography = await createTypography({ event, rng, bounds: architecture.bounds });
    const bats = createBats({ rng });
    if (ticket !== building) {
      disposeGroup(architecture.group);
      disposeGroup(typography.group);
      disposeGroup(bats.group);
      return;
    }
    clearWorld();
    stage.scene.add(architecture.group, typography.group, bats.group);
    typography.group.visible = view.poster;
    typography.setFlat(view.flat, stage.camera);
    architecture.setPoster(view.poster);
    typography.setDaysLeft(view.countdown ? daysLeft : null);
    const rig = createCameraRig({ camera: stage.camera, bounds: architecture.bounds, rng });
    rig.setMode(view.mode);
    world = { architecture, typography, bats, rig };
  }

  function clearWorld() {
    if (!world) return;
    for (const part of [world.architecture, world.typography, world.bats]) {
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

  /** Плотность холста под дубль: экранная, если она уже даёт нужную высоту, иначе поднятая. */
  function takeDensity() {
    const wanted = TAKE_HEIGHTS[view.quality];
    if (!wanted) return 0;
    return Math.min(wanted / frameSize(FRAMINGS[view.framing]).height, MAX_DENSITY);
  }

  async function startTake(seconds) {
    if (recorder.recording) return;
    panel.setRecording(true);
    // Холст растёт до дубля: размер файла рекордер берёт у холста один раз, на старте.
    canvasDensity = takeDensity();
    layout();
    let take = null;
    try {
      take = await recorder.start();
    } catch (error) {
      canvasDensity = 0;
      layout();
      panel.setRecording(false);
      panel.note(`Запись не пошла: ${error.message}`);
      return;
    }
    takeEndsAt = performance.now() + seconds * 1000;
    // Размер, формат и битрейт видно до дубля, а не после: мутный файл переснимают, а не чинят.
    const format = take.mimeType.includes('mp4') ? 'mp4' : 'webm';
    const wanted = TAKE_HEIGHTS[view.quality];
    const short = wanted && take.height < wanted
      ? `, окно мало: ждали ${wanted} по высоте`
      : '';
    panel.note(
      `Пишу ${seconds} с: ${take.width}×${take.height}, ${format}, ${megabits(take.videoBitsPerSecond)}${short}`,
    );
  }

  async function finishTake() {
    takeEndsAt = Infinity;
    try {
      const { blob, dropped } = await recorder.stop();
      const name = `${fileStem()}.${videoExtension(blob)}`;
      download(blob, name);
      // Кодировщик роняет кадр, когда не успевает, и молчать об этом нельзя: дубль от
      // этого не рвётся, но идёт рывками, а причина не видна ни в файле, ни в кадре.
      const lost = dropped ? `, кадров упало: ${dropped}` : '';
      panel.note(`Готово: ${name}, ${megabytes(blob.size)}${lost}`);
    } catch (error) {
      panel.note(`Запись сорвалась: ${error.message}`);
    } finally {
      // Холст дубля экрану велик: на нём кадры в секунду стоят вчетверо дороже.
      canvasDensity = 0;
      layout();
    }
    panel.setRecording(false);
  }

  /**
   * Снимок холста в файл. `after` возвращает холст к экранному размеру, когда он снят.
   *
   * `caveat` дописывается к строке готовности, а не говорится отдельной: пульт держит одну
   * заметку, и сказанное до снимка затирается его же «готово» через долю секунды.
   */
  function saveFrameImage(name, after = () => {}, caveat = '') {
    stage.renderer.domElement.toBlob((blob) => {
      after();
      if (!blob) {
        panel.note('Кадр не снялся: холст пуст');
        return;
      }
      download(blob, name);
      panel.note(`Готово: ${name}, ${megabytes(blob.size)}${caveat}`);
    }, 'image/png');
  }

  function applyKnobs(values) {
    for (const [name, value] of Object.entries(values)) effects.controls[name]?.set(value);
    panel.showKnobs();
  }

  /**
   * Печатный вид меняет только ручки постобработки.
   *
   * Экранные значения режим забирает себе и возвращает при выключении: иначе выход из него
   * сбрасывал бы подобранные руками эффекты на дефолтные. На старте страница входит сюда
   * сама, и забранным оказывается ровно то, с чем ручки родились, то есть экранный вид.
   */
  function usePrint(active) {
    view.print = active;
    if (active) {
      screenKnobs = Object.fromEntries(
        Object.entries(effects.controls).map(([name, knob]) => [name, knob.get()]),
      );
      applyKnobs(PRINT_KNOBS);
      return;
    }
    applyKnobs(screenKnobs ?? {});
    screenKnobs = null;
  }

  /**
   * Фото: тот же кадр, снятый крупнее окна.
   *
   * Время на снимке стоит, меняется только плотность холста, поэтому в файл уходит ровно
   * то, что нашли на экране, а не соседний кадр движения. Ни поле зрения, ни пропорция кадра
   * от плотности не двигаются, и двигаться не должны: снимок обязан повторить то, что
   * подобрали глазами, а не соседнее кадрирование. Плотность держится один кадр: на экране
   * такой холст стоил бы кадров в секунду, а снимок платит ими один раз.
   *
   * Потолок плотности не молчит. В маленьком окне снимок выходит ниже обещанного, и под
   * печать это не триста точек на дюйм, а сколько получилось; окно побольше и правда даёт
   * кадр крупнее, так что сказать об этом дешевле, чем потом искать причину в файле.
   */
  function shootPhoto(elapsed) {
    const { height } = frameSize(FRAMINGS[view.framing]);
    const target = view.print ? PHOTO.printHeight : PHOTO.height;
    const wanted = target / height;
    layout(Math.min(wanted, MAX_DENSITY));
    renderScene(0, elapsed);
    const shot = stage.renderer.domElement.height;
    const short = wanted > MAX_DENSITY ? `, окно мало: ждали ${target}, разверни и сними ещё` : '';
    saveFrameImage(`${fileStem()}-${shot}p.png`, () => layout(), short);
  }

  /**
   * Сцена наружу файлом: зал и афиша уходят в GLB, OBJ или FBX.
   *
   * Файлов на выгрузку бывает больше одного: OBJ несёт свой MTL рядом и находит его только
   * по имени, поэтому имена даёт сама выгрузка, а здесь их только сохраняют.
   *
   * Слепок со сцены снимается разом, а картинки экспортёр жуёт сам и поток между ними
   * отпускает: отрисовка идёт своим чередом, и кадр на время сборки не встаёт.
   */
  async function saveSceneFile(format) {
    if (!world) {
      panel.note('Сцена ещё не собралась');
      return;
    }
    panel.setExporting(true);
    panel.note(`Собираю сцену в ${format.toUpperCase()}`);
    try {
      const { exportScene } = await import('./export-scene.js').catch((error) => {
        throw new Error(`export-scene.js не загрузился: ${error.message}`);
      });
      const files = await exportScene({
        sources: [world.architecture.group, world.typography.group],
        format,
        stem: fileStem(),
      });
      for (const file of files) download(file.blob, file.name);
      const weight = files.reduce((total, file) => total + file.blob.size, 0);
      panel.note(`Готово: ${files.map((file) => file.name).join(', ')}, ${megabytes(weight)}`);
    } catch (error) {
      panel.note(`Сцена не выгрузилась: ${error.message}`);
    } finally {
      panel.setExporting(false);
    }
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
    renderScene(dt, elapsed);

    if (recorder.recording) recorder.frame();
    if (wantsStillFrame) {
      wantsStillFrame = false;
      saveFrameImage(`${fileStem()}.png`);
    }
    if (wantsPhoto) {
      wantsPhoto = false;
      shootPhoto(elapsed);
    }
    if (performance.now() >= takeEndsAt) finishTake();

    const measured = measure(dt);
    if (measured) panel.showStats(measured);
  }

  /** Один кадр мира на холст: его же зовёт снимок, поэтому отрисовка отдельно от съёмки. */
  function renderScene(dt, elapsed) {
    stage.renderer.info.reset();
    stage.update(dt, elapsed);
    world?.architecture.update(elapsed);
    const walking = view.mode === WALK_MODE && walk !== null;
    if (walking) walk.update(dt);
    else world?.rig.update(dt, elapsed);
    // Камера ведёт сборку афиши, поэтому она ходит раньше типографики: иначе строки едут
    // по доле прошлого кадра, а железо плит доезжает до них ещё кадром позже.
    world?.typography.assemble(walking ? 1 : world.rig.reveal);
    world?.typography.update(dt, elapsed);
    world?.bats.update(elapsed);
    effects.render(
      dt,
      elapsed,
      world && !walking ? world.rig.motion : STILL_MOTION,
      world && !walking ? world.rig.focusDistance : WALK_FOCUS_METRES,
    );
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
  const response = await fetch('understav.json');
  if (!response.ok) throw new Error(`understav.json не отдался: ${response.status}`);
  const event = await response.json();
  if (!event?.event || !event?.date || !Array.isArray(event.lineup)) {
    throw new Error('understav.json без события, даты или лайнапа');
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

function megabytes(bytes) {
  return `${(bytes / MEGABYTE).toFixed(1)} МБ`;
}

function megabits(bits) {
  return `${(bits / MEGABIT).toFixed(0)} Мбит/с`;
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
