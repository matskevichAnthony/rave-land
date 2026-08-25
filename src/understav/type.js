import * as THREE from 'three';
import { burnIron, emissiveBoost } from './burn.js';
import { gothicFaceFor, loadGothic } from './gothic.js';
import { createWordmark } from './wordmark.js';
import { BEAT, PALETTE } from './palette.js';
import { createStencil, measureWidthPerCap, NARROW_FACE } from './text-texture.js';

/**
 * Типографика сцены UNDERSTAV: заголовок, тэглайн, лайнап, дата и отсчёт дней.
 *
 * Буквы это предметы нефа, а не слой поверх кадра: заголовок отлит готическим текстуром в
 * металле с прожжённой фаской, остальное вырезано трафаретом в подвешенных стальных плитах.
 */

const BOX_WIDTH = 12;
// Коробка выше зала прежнего: набор перерос её, а первым делом строки съедают промежутки,
// и блоки афиши слипались в одну простыню.
const BOX_HEIGHT = 9.4;
const BOX_TOP = 11.8;
const NAVE_HEADROOM = 2;

// Знак почти квадратный, и посаженный по ширине коробки он закрывает её целиком. Поэтому
// его держит доля высоты, а ширина остаётся потолком: длинная афиша упрётся в неё, высокая
// в высоту, и обе останутся внутри коробки.
//
// Доля выбрана разменом, а не на глаз. Знак это самая высокая строка афиши, и воздух между
// остальными строками берётся только у него: на половине коробки блок вырастал на четыре
// метра выше неё, и адрес внизу уходил в пол. На 0.36 знак остаётся впятеро выше любой
// строки лайнапа, а промежутки перестают сжиматься в слипшийся столбик.
const TITLE_HEIGHT_RATIO = 0.36;
const TITLE_WIDTH_RATIO = 0.95;
// Название словом стоит вдвое уже знака и читается подписью под ним. Шире оно начинает
// спорить со знаком за главное место в кадре, а знак у события один и спорить ему не с чем.
const NAMELINE_WIDTH_RATIO = 0.5;
const LINEUP_WIDTH_RATIO = 0.72;
// Подзаголовок чуть шире коробки лайнапа: коробку держит длина имён, а подзаголовок вдвое
// длиннее самого длинного из них и по ней читался бы петитом. Дальше единицы он не идёт,
// иначе строка перерастает заголовок по ширине и афиша встаёт на подзаголовке.
const TAGLINE_WIDTH_RATIO = 1;
const DATE_WIDTH_RATIO = 0.66;
const VENUE_WIDTH_RATIO = 0.52;

const TITLE_Z = 0.3;
const PLATE_Z = -0.35;

const TITLE_TILT = 0.022;


const CAP_SCALE = [0.28, 0.36, 0.46, 0.58, 0.72, 0.9];
const PLATE_TRACKING = 0.22;
// Дата и адрес набраны в разрядку клеймом по железу: строка мелким кеглем внизу читается
// подписью в углу листовки, а не отметкой на балке.
const MARK_TRACKING = 0.55;
// Готика плотнее гротеска и на разгоне разваливается на отдельные знаки, поэтому её строка
// набирается почти вплотную.
const GOTHIC_TRACKING = 0.025;
const PLATE_PAD_X = 0.3;
const PLATE_PAD_Y = 0.12;
const PLATE_DEPTH = 0.09;
const RULE_WIDTH_RATIO = 0.44;
const RULE_THICKNESS = 0.06;
const RULE_DEPTH = 0.05;
const RULE_EMISSIVE = 1.1;

const PLATE_RIM = 0.05;
const PLATE_FACE_RELIEF = 0.02;
const STENCIL_LIFT = 0.006;
// Порог ниже половины намеренно: с уменьшением плиты мипмап съедает тонкий штрих, и по
// строгому порогу мелкое имя рассыпается раньше, чем становится нечитаемым по кеглю.
const STENCIL_ALPHA_TEST = 0.38;
const RAGGED_SHIFT = 0.6;

// Сборка афиши на пролёте: строки прилетают по одной, попеременно из-за левого и правого
// края зала, и садятся на своё место. Разгон меряется местами в очереди, а не секундами:
// длина пролёта зависит от кадра, а порядок строк нет.
const ASSEMBLE_SLIDE = 24;
const ASSEMBLE_SPAN = 1.7;

// Наименьшая доля промежутка, которая переживает сжатие. Одних строк афиши на шесть имён уже
// больше, чем высота коробки, поэтому без порога сжатие уходило в ноль и строки вставали
// впритык: тэглайн садился на плиту хедлайнера. Коробка это ориентир, а не рама, и блоку
// разрешено из неё вылезти; чего не разрешено, так это слипнуться.
const MIN_SQUEEZE = 0.34;

// Плоский набор: афиша перестаёт быть предметом зала и становится тем, чем она и является в
// ленте, картинкой поверх кадра. Её вешают на камеру, поэтому ракурс её больше не касается:
// как бы ни стоял риг, строки видны анфас и целиком. Заодно это дешевле: набор выходит из
// теней и из проверки глубины, то есть перестаёт стоить второго обхода и споров с геометрией.
const FLAT_DISTANCE = 8;
const FLAT_FILL = 0.92;
// Поверх всего, что рисует сцена: набор снят с проверки глубины и обязан лечь последним.
const FLAT_ORDER = 900;

// Афиша это три блока: шапка, лайнап, подвал. Внутри блока строки стоят вплотную, между
// блоками промежуток на порядок больше, иначе тэглайн читается ещё одним артистом.
const GAP_AFTER_TITLE = 0.34;
const GAP_AFTER_NAMELINE = 0.5;
const GAP_AFTER_TAGLINE = 1.2;
const GAP_IN_LINEUP = 0.24;
const GAP_AFTER_LINEUP = 0.75;
const GAP_AFTER_RULE = 0.75;
const GAP_AFTER_DATE = 0.1;

const COUNTDOWN_WIDTH = 6.4;
const COUNTDOWN_HEIGHT = 4.8;
// Роза стоит на двадцать метров глубже заголовка, и перспектива тянет её вниз, к линии
// взгляда: на высоте центра окна цифра оказывается ровно за буквами. Отсюда подъём.
const COUNTDOWN_Y = 16.4;
const COUNTDOWN_Z = -21.5;
const COUNTDOWN_TRACKING = 0.06;
const COUNTDOWN_CAP_FRACTION = 0.86;
const COUNTDOWN_PADDING = 0.04;
const COUNTDOWN_PULSE = 0.035;

/** В схеме события пока нет своего слова для нулевого дня, поэтому оно ждёт поля `todayLabel`. */
const DEFAULT_TODAY_LABEL = 'СЕГОДНЯ';

const PLATE_EMISSIVE_BASE = 1.6;
const HEADLINER_GLOW = 0.62;
const HEADLINER_INK = '#2a0509';
const PLATE_EMISSIVE_CAP = 0.58;
const PLATE_EMISSIVE_BOOST = 1.6;
const COUNTDOWN_EMISSIVE_BASE = 1.4;
const COUNTDOWN_EMISSIVE_SWING = 1.6;
const BREATH_SHARPNESS = 3;

const SWAY_MIN = 0.006;
const SWAY_MAX = 0.018;
const SWAY_TILT_RATIO = 0.55;
const SWAY_BEATS_MIN = 6;
const SWAY_BEATS_MAX = 11;

const TAU = Math.PI * 2;

// Черновики матриц инстансов: пересчёт идёт каждый кадр, и новых объектов он заводить не должен.
const localSlab = new THREE.Object3D();
const slabMatrix = new THREE.Matrix4();
const draftPoint = new THREE.Vector3();
const draftScale = new THREE.Vector3();
const IDENTITY_TURN = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

const REQUIRED_EVENT_FIELDS = ['event', 'dateLabel', 'lineup'];

function requireEventFields(event) {
  const missing = REQUIRED_EVENT_FIELDS.filter((field) => !event?.[field]?.length);
  if (missing.length > 0) {
    throw new Error(`understav: событие без полей ${missing.join(', ')}, типографике нечего набирать`);
  }
}

function resolveBox(bounds) {
  const naveWidth = bounds?.radius ? bounds.radius * 2 : BOX_WIDTH;
  const naveTop = bounds?.height ? bounds.height - NAVE_HEADROOM : BOX_TOP;
  return {
    width: Math.min(BOX_WIDTH, naveWidth),
    top: Math.min(BOX_TOP, naveTop),
    height: BOX_HEIGHT,
  };
}

/**
 * Заголовок афиши: знак события, отлитый в железо и раскалённый по фаске.
 *
 * Знак приходит готовой геометрией в долях своей высоты, а метры ему назначают здесь: он
 * почти квадратный, и что его сажает, высота или ширина коробки, зависит от кадрирования.
 * Берётся меньшее из двух, иначе в вертикальном кадре знак вылезает за края, а в широком
 * съедает место под лайнап.
 */
function createTitle({ wordmark, rng, targetWidth, targetHeight }) {
  const height = Math.min(targetHeight, targetWidth / wordmark.aspect);
  const width = height * wordmark.aspect;
  const iron = burnIron({ geometry: wordmark.geometry, span: wordmark.aspect, rng });

  const mesh = new THREE.Mesh(wordmark.geometry, iron.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.setScalar(height);
  // Знак стоит краской от нуля вверх, а афиша строится сверху вниз: его опускают на всю
  // высоту, и верх краски садится ровно на верхний край коробки.
  mesh.position.set(-width / 2, -height, TITLE_Z);
  mesh.rotation.z = rng.range(-TITLE_TILT, TITLE_TILT);

  const group = new THREE.Group();
  group.add(mesh);
  return { group, height, burn: iron.burn };
}

/** Кегль подбирается по шкале: имена разной длины, а коробка одна. */
/**
 * Кегль строки под ширину плиты.
 *
 * Обычно кегль садится на ступень общей шкалы: лайнап обязан идти одним кеглем, а плиты
 * разной длины иначе разъедутся по высоте буквы. Одиночной строке ровняться не с кем, и
 * ступень у неё отнимает до четверти кегля впустую, поэтому она садится точно по месту.
 */
function fitCapHeight(text, { tracking, face, maxWidth }, exact = false) {
  const widthPerCap = measureWidthPerCap(text, tracking, face);
  const usable = maxWidth - PLATE_PAD_X * 2;
  if (exact) return usable / widthPerCap;
  for (let step = CAP_SCALE.length - 1; step >= 0; step -= 1) {
    if (CAP_SCALE[step] * widthPerCap <= usable) return CAP_SCALE[step];
  }
  return usable / widthPerCap;
}

function createPlateMaterials() {
  return {
    rim: new THREE.MeshStandardMaterial({ color: PALETTE.rust, metalness: 0.8, roughness: 0.9 }),
    face: new THREE.MeshStandardMaterial({ color: PALETTE.iron, metalness: 0.9, roughness: 0.55 }),
  };
}

function slab(geometry, material, width, height, depth, z) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.set(width, height, depth);
  mesh.position.set(0, -height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Локальная матрица предмета на строке: строка качается, предмет едет вместе с ней. */
function anchoredAt(anchor, { position, quaternion, scale }) {
  localSlab.position.copy(position);
  localSlab.quaternion.copy(quaternion ?? IDENTITY_TURN);
  localSlab.scale.copy(scale);
  localSlab.updateMatrix();
  return { anchor, matrix: localSlab.matrix.clone() };
}

/** Плита строки: коробка стоит под якорем строки, отсчёт габаритов идёт от её верхней кромки. */
function anchoredSlab(anchor, { width, height, depth, z }) {
  return anchoredAt(anchor, {
    position: draftPoint.set(0, -height / 2, z),
    scale: draftScale.set(width, height, depth),
  });
}

/**
 * Железо всех плит двумя инстансами: кант и лицо.
 *
 * Отдельными мешами афиша стоила восьми вызовов отрисовки на строку (кадр рисует сцену
 * трижды: глубина, тени, цвет), то есть трети всего бюджета кадра на текст. Форма и материал
 * у плит общие, разнятся только габариты, и это ровно случай инстанса.
 */
function buildAnchoredInstances(plans, geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, plans.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return {
    mesh,
    refresh() {
      for (const [index, plan] of plans.entries()) {
        plan.anchor.updateMatrixWorld();
        mesh.setMatrixAt(index, slabMatrix.multiplyMatrices(plan.anchor.matrixWorld, plan.matrix));
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

/**
 * Планка между лайнапом и подвалом.
 *
 * Воздуха мало: он говорит о паузе, но не о том, что блок кончился. Планка светится сама,
 * иначе тёмное железо на тёмном зале просто не видно, и разделителя как не было.
 */
function createRule({ shared, width }) {
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.iron,
    emissive: PALETTE.ember,
    emissiveIntensity: RULE_EMISSIVE * emissiveBoost(PALETTE.ember),
    metalness: 0.9,
    roughness: 0.4,
  });
  const bar = slab(shared.box, material, width, RULE_THICKNESS, RULE_DEPTH, PLATE_Z);
  bar.castShadow = false;

  const group = new THREE.Group();
  group.add(bar);
  return { group, height: RULE_THICKNESS };
}

function createPlate({
  text, maxWidth, capHeight, emissive, rng, shared,
  worn = false, face = NARROW_FACE, tracking = PLATE_TRACKING, fillWidth = false,
  ink = PALETTE.concrete, glow = null,
}) {
  const widthPerCap = measureWidthPerCap(text, tracking, face);
  const width = fillWidth ? maxWidth : Math.min(maxWidth, capHeight * widthPerCap + PLATE_PAD_X * 2);
  const height = capHeight + PLATE_PAD_Y * 2;

  const stencil = createStencil({ width, height, rng, worn });
  stencil.paint(text, {
    face,
    tracking,
    capFraction: capHeight / height,
    padding: PLATE_PAD_X / width,
    justify: fillWidth,
  });

  const material = new THREE.MeshStandardMaterial({
    color: ink,
    emissive,
    // Шкала кеглей не должна менять яркость строки: длинное имя садится на мелкий кегль,
    // его штрих тоньше и на экране гаснет, поэтому мелкая плита светит сильнее крупной.
    emissiveIntensity: PLATE_EMISSIVE_BASE * (glow ?? emissiveBoost(emissive))
      * Math.min(PLATE_EMISSIVE_CAP / capHeight, PLATE_EMISSIVE_BOOST),
    alphaMap: stencil.texture,
    alphaTest: STENCIL_ALPHA_TEST,
    metalness: 0.6,
    roughness: 0.35,
  });

  const frontDepth = PLATE_DEPTH + PLATE_FACE_RELIEF;
  const group = new THREE.Group();
  shared.slabs.rim.push(anchoredSlab(group, {
    width: width + PLATE_RIM * 2,
    height: height + PLATE_RIM * 2,
    depth: PLATE_DEPTH,
    z: PLATE_Z,
  }));
  shared.slabs.front.push(anchoredSlab(group, { width, height, depth: frontDepth, z: PLATE_Z }));

  const stencilFace = slab(
    shared.plane,
    material,
    width,
    height,
    1,
    PLATE_Z + frontDepth / 2 + STENCIL_LIFT,
  );
  stencilFace.castShadow = false;

  group.add(stencilFace);
  group.position.x = rng.range(-1, 1) * ((maxWidth - width) / 2) * RAGGED_SHIFT;

  return {
    group,
    height,
    sway: {
      amplitude: rng.range(SWAY_MIN, SWAY_MAX),
      omega: TAU / (BEAT.seconds * rng.range(SWAY_BEATS_MIN, SWAY_BEATS_MAX)),
      phase: rng.range(0, TAU),
    },
  };
}

/**
 * Отсчёт живёт в розе-окне за алтарём: в вертикальном кадре верхняя треть занята окном,
 * и цифра там читается силуэтом на холодном свете, не отбирая место у заголовка.
 */
function createCountdown({ rng, todayLabel }) {
  const stencil = createStencil({ width: COUNTDOWN_WIDTH, height: COUNTDOWN_HEIGHT });
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.iron,
    emissive: PALETTE.ember,
    emissiveIntensity: COUNTDOWN_EMISSIVE_BASE,
    alphaMap: stencil.texture,
    alphaTest: STENCIL_ALPHA_TEST,
    metalness: 0.85,
    roughness: 0.4,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(COUNTDOWN_WIDTH, COUNTDOWN_HEIGHT), material);
  mesh.position.set(0, COUNTDOWN_Y, COUNTDOWN_Z);
  mesh.castShadow = true;
  mesh.visible = false;

  let painted = null;
  return {
    mesh,
    material,
    show(days) {
      if (!Number.isFinite(days) || days < 0) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      const label = days <= 0 ? todayLabel : String(Math.round(days));
      if (label === painted) return;
      painted = label;
      stencil.paint(label, {
        face: NARROW_FACE,
        tracking: COUNTDOWN_TRACKING,
        capFraction: COUNTDOWN_CAP_FRACTION,
        padding: COUNTDOWN_PADDING,
      });
    },
  };
}

/** Строки кладутся сверху вниз; если набор перерос коробку, первыми жмутся промежутки. */
function stackRows(rows, box) {
  const content = rows.reduce((sum, item) => sum + item.row.height, 0);
  const gaps = rows.reduce((sum, item) => sum + item.gap, 0);
  const squeeze = gaps > 0
    ? THREE.MathUtils.clamp((box.height - content) / gaps, MIN_SQUEEZE, 1)
    : 1;
  let cursor = box.top - (box.height - content - gaps * squeeze) / 2;
  for (const item of rows) {
    item.row.group.position.y = cursor;
    cursor -= item.row.height + item.gap * squeeze;
  }
}

/**
 * Набор поверх кадра: снят с глубины и с теней, кладётся последним.
 *
 * Исходные значения запоминаются на самих объектах, потому что материал у плит свой, а у
 * железа общий на все инстансы: снимок «как было» с одного места не восстановил бы остальные.
 */
function liftFromDepth(group, lifted) {
  group.traverse((node) => {
    if (!node.isMesh) return;
    lifted.push({
      node,
      order: node.renderOrder,
      cast: node.castShadow,
      receive: node.receiveShadow,
      materials: [node.material].flat().map((material) => ({
        material, test: material.depthTest, write: material.depthWrite,
      })),
    });
    node.renderOrder = FLAT_ORDER;
    node.castShadow = false;
    node.receiveShadow = false;
    for (const material of [node.material].flat()) {
      material.depthTest = false;
      material.depthWrite = false;
    }
  });
}

function dropBackToDepth(lifted) {
  for (const item of lifted) {
    item.node.renderOrder = item.order;
    item.node.castShadow = item.cast;
    item.node.receiveShadow = item.receive;
    for (const entry of item.materials) {
      entry.material.depthTest = entry.test;
      entry.material.depthWrite = entry.write;
    }
  }
}

/**
 * Габариты блока строк в его собственных координатах.
 *
 * Меряются один раз, пока набор ещё стоит в зале нетронутым. Мерить его после привязки к
 * камере нельзя: `setFromObject` считает в мировых координатах, и в них уже сидит поворот
 * самой камеры, отчего блок уезжает из кадра тем сильнее, чем круче ракурс. Отсчёт не
 * замусорен и цифрой обратного отсчёта: она висит на розе в двадцати метрах позади афиши.
 */
function measureLayout(rows) {
  const bounds = new THREE.Box3();
  for (const item of rows) bounds.expandByObject(item.row.group);
  return { size: bounds.getSize(new THREE.Vector3()), centre: bounds.getCenter(new THREE.Vector3()) };
}

/** Во сколько раз ужать блок таких габаритов, чтобы он целиком встал в кадр этой камеры. */
function fitToFrame(layout, camera) {
  const visibleHeight = 2 * FLAT_DISTANCE * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  return FLAT_FILL * Math.min(
    (visibleHeight * camera.aspect) / layout.size.x,
    visibleHeight / layout.size.y,
  );
}

/** Мягкая посадка: строка приходит быстро и гасит скорость у самого своего места. */
function settle(t) {
  return 1 - (1 - t) ** 3;
}

function breath(elapsed, omega) {
  return Math.pow(0.5 + 0.5 * Math.sin(elapsed * omega), BREATH_SHARPNESS);
}

/**
 * Набор афиши в готовую коробку.
 *
 * Коробку можно принести свою: `{ width, top, height }` в метрах мира. Сцена, у которой
 * место под текст выбрано архитектурой, отдаёт его сюда, а не подгоняет габариты зала так,
 * чтобы вывод совпал. Без неё коробка выводится из габаритов, как и раньше.
 */
export async function createTypography({ event, rng, bounds, box = resolveBox(bounds) }) {
  requireEventFields(event);
  await loadGothic();
  const shared = {
    box: new THREE.BoxGeometry(1, 1, 1),
    plane: new THREE.PlaneGeometry(1, 1),
    materials: createPlateMaterials(),
    slabs: {
      rim: [], front: [],
    },
  };

  const title = createTitle({
    wordmark: await createWordmark({ rng, tilt: TITLE_TILT }),
    rng,
    targetWidth: box.width * TITLE_WIDTH_RATIO,
    targetHeight: box.height * TITLE_HEIGHT_RATIO,
  });

  // Название словом набрано тем же узким гротеском, что имена и дата, а не готикой в объёме.
  // Готическая строка под знаком читалась вторым знаком и спорила с ним; обычный текст этого
  // не делает и работает подписью, ради которой его сюда и ставили.
  const nameFit = { tracking: PLATE_TRACKING, face: NARROW_FACE, maxWidth: box.width * NAMELINE_WIDTH_RATIO };
  const nameline = createPlate({
    text: event.event,
    maxWidth: nameFit.maxWidth,
    capHeight: fitCapHeight(event.event, nameFit),
    emissive: PALETTE.bone,
    rng,
    shared,
  });

  const taglineFace = gothicFaceFor(event.tagline ?? '');
  const taglineFit = { tracking: GOTHIC_TRACKING, face: taglineFace, maxWidth: box.width * TAGLINE_WIDTH_RATIO };
  // Строка одна на афише, ступень шкалы ей ни к чему: подзаголовок в тридцать знаков и без
  // того вдвое мельче заголовка, а на телефоне он с округления вниз пропадает вовсе.
  const taglineCap = fitCapHeight(event.tagline ?? '', taglineFit, true);
  // Тэглайн необязателен: сцена собирается и без него, если строки нет в данных события.
  const tagline = event.tagline ? createPlate({
    text: event.tagline,
    maxWidth: taglineFit.maxWidth,
    capHeight: taglineCap,
    emissive: PALETTE.bone,
    rng,
    shared,
    face: taglineFace,
    tracking: GOTHIC_TRACKING,
  }) : null;

  // Лайнап набирается одним кеглем по самому длинному имени: разный кегль читается рангом,
  // а ранга у этих имён нет, есть только разная длина ников. Плиты одной ширины, и короткое
  // имя не сжимается в середину, а разгоняется на всю: столбик из плит разной ширины скачет
  // из стороны в сторону, а лайнап это блок. Блок узкий, чуть шире даты: набранный во всю
  // коробку, он закрывает собой зал, ради которого сцену и строили.
  const lineupFit = { tracking: PLATE_TRACKING, face: NARROW_FACE, maxWidth: box.width * LINEUP_WIDTH_RATIO };
  const lineupCap = Math.min(...event.lineup.map((name) => fitCapHeight(name, lineupFit)));
  const lineup = event.lineup.map((name, index) => createPlate({
    text: name,
    maxWidth: lineupFit.maxWidth,
    capHeight: lineupCap,
    emissive: index === 0 ? PALETTE.blood : PALETTE.bone,
    // Хедлайнер обязан читаться красным. Подъём яркости под порог свечения на нём вреден:
    // красное имя выходит за порог блума и в ореоле выцветает до розового, поэтому у него
    // своя, сдержанная сила и своя тёмная краска, на которой цвет остаётся кровью.
    ...(index === 0 ? { ink: HEADLINER_INK, glow: HEADLINER_GLOW } : {}),
    rng,
    shared,
    // Потёртости живут только на именах: зал жуёт афишу, но дата и подпись обязаны читаться.
    worn: true,
    fillWidth: true,
  }));

  const dateFit = { tracking: MARK_TRACKING, face: NARROW_FACE, maxWidth: box.width * DATE_WIDTH_RATIO };
  const date = createPlate({
    text: event.dateLabel,
    maxWidth: dateFit.maxWidth,
    capHeight: fitCapHeight(event.dateLabel, dateFit),
    emissive: PALETTE.moon,
    tracking: MARK_TRACKING,
    rng,
    shared,
  });

  // Адрес необязателен ровно как тэглайн: сцена собирается и без него.
  const venueFit = { tracking: MARK_TRACKING, face: NARROW_FACE, maxWidth: box.width * VENUE_WIDTH_RATIO };
  const venue = event.venue ? createPlate({
    text: event.venue,
    maxWidth: venueFit.maxWidth,
    capHeight: fitCapHeight(event.venue, venueFit),
    emissive: PALETTE.bone,
    tracking: MARK_TRACKING,
    rng,
    shared,
  }) : null;

  const rule = createRule({ shared, width: box.width * RULE_WIDTH_RATIO });

  const rows = [
    { row: title, gap: GAP_AFTER_TITLE },
    // Название словом идёт сразу под знаком: знак читается силуэтом, и без строки под ним
    // тот, кто видит его впервые, слова в нём не разбирает.
    { row: nameline, gap: GAP_AFTER_NAMELINE },
    // Тэглайн стоит подписью под названием, а не отдельной строкой внизу: он объясняет, что
    // это за вечер, и читается только рядом с тем, к чему относится.
    ...(tagline ? [{ row: tagline, gap: GAP_AFTER_TAGLINE }] : []),
    ...lineup.map((row, index) => ({
      row,
      gap: index < lineup.length - 1 ? GAP_IN_LINEUP : GAP_AFTER_LINEUP,
    })),
    { row: rule, gap: GAP_AFTER_RULE },
    { row: date, gap: GAP_AFTER_DATE },
    ...(venue ? [{ row: venue, gap: 0 }] : []),
  ];
  stackRows(rows, box);

  const countdown = createCountdown({ rng, todayLabel: event.todayLabel ?? DEFAULT_TODAY_LABEL });

  const group = new THREE.Group();
  for (const item of rows) group.add(item.row.group);
  group.add(countdown.mesh);

  const iron = [
    buildAnchoredInstances(shared.slabs.rim, shared.box, shared.materials.rim),
    buildAnchoredInstances(shared.slabs.front, shared.box, shared.materials.face),
  ];
  group.add(...iron.map((instance) => instance.mesh));

  const plates = [nameline, ...(tagline ? [tagline] : []), ...lineup, date, ...(venue ? [venue] : [])];
  const beatOmega = TAU / BEAT.seconds;

  // Строки прилетают в том же порядке, в каком стоят в афише, и через одну с разных сторон.
  // Место покоя у строки своё, поэтому влёт считается от него, а не вместо него.
  const flying = rows.map((item, index) => ({
    group: item.row.group,
    restX: item.row.group.position.x,
    from: index % 2 === 0 ? -1 : 1,
  }));
  let assembled = 1;

  let flatRest = null;
  const lifted = [];
  const layout = measureLayout(rows);

  return {
    group,
    /**
     * Плоский набор: афиша уходит из зала на камеру и встаёт ровно в кадр.
     *
     * Возврат обязателен со снимка, а не пересчётом: место набора в зале выбрано раскладкой,
     * и восстановить его формулой значит завести вторую раскладку рядом с первой.
     */
    setFlat(active, camera) {
      if (active === Boolean(flatRest)) {
        if (active) this.refitFlat(camera);
        return;
      }
      if (active) {
        flatRest = {
          parent: group.parent,
          position: group.position.clone(),
          quaternion: group.quaternion.clone(),
          scale: group.scale.clone(),
        };
        liftFromDepth(group, lifted);
        camera.add(group);
        this.refitFlat(camera);
        return;
      }
      dropBackToDepth(lifted);
      lifted.length = 0;
      flatRest.parent?.add(group);
      group.position.copy(flatRest.position);
      group.quaternion.copy(flatRest.quaternion);
      group.scale.copy(flatRest.scale);
      flatRest = null;
    },
    /** Пересадка под новый кадр: угол объектива и пропорции меняются, посадка обязана следом. */
    refitFlat(camera) {
      if (!flatRest) return;
      const scale = fitToFrame(layout, camera);
      group.quaternion.identity();
      group.scale.setScalar(scale);
      group.position.set(
        -layout.centre.x * scale,
        -layout.centre.y * scale,
        -FLAT_DISTANCE - layout.centre.z * scale,
      );
    },
    setDaysLeft(days) {
      countdown.show(days);
    },
    /**
     * Насколько афиша собрана: ноль это пустой зал, единица это готовый плакат.
     *
     * Долю даёт камера, потому что собирается афиша по ходу пролёта, а её время знает риг.
     */
    assemble(progress) {
      const ready = THREE.MathUtils.clamp(progress, 0, 1);
      if (ready === assembled) return;
      assembled = ready;
      const front = ready * (flying.length + ASSEMBLE_SPAN);
      for (let index = 0; index < flying.length; index += 1) {
        const row = flying[index];
        const arrived = settle(THREE.MathUtils.clamp((front - index) / ASSEMBLE_SPAN, 0, 1));
        row.group.position.x = row.restX + (1 - arrived) * row.from * ASSEMBLE_SLIDE;
      }
    },
    update(dt, elapsed) {
      title.burn(elapsed);

      for (const plate of plates) {
        const angle = elapsed * plate.sway.omega + plate.sway.phase;
        plate.group.rotation.z = plate.sway.amplitude * Math.sin(angle);
        plate.group.rotation.x = plate.sway.amplitude * SWAY_TILT_RATIO * Math.cos(angle);
      }
      // Железо плит живёт инстансами, и качание доезжает до него матрицами, а не иерархией.
      for (const instance of iron) instance.refresh();

      if (!countdown.mesh.visible) return;
      const pulse = breath(elapsed, beatOmega);
      countdown.material.emissiveIntensity = COUNTDOWN_EMISSIVE_BASE + COUNTDOWN_EMISSIVE_SWING * pulse;
      countdown.mesh.scale.setScalar(1 + COUNTDOWN_PULSE * pulse);
    },
  };
}
