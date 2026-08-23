import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GOTHIC_FACE, GOTHIC_TYPEFACE, loadGothic } from './gothic.js';
import { BEAT, PALETTE } from './palette.js';
import { createStencil, measureWidthPerCap, NARROW_FACE } from './text-texture.js';

/**
 * Типографика сцены UNDERSTAV: заголовок, тэглайн, лайнап, дата и отсчёт дней.
 *
 * Буквы это предметы нефа, а не слой поверх кадра: заголовок отлит готическим текстуром в
 * металле с прожжённой фаской, остальное вырезано трафаретом в подвешенных стальных плитах.
 */

const BOX_WIDTH = 12;
const BOX_HEIGHT = 9;
const BOX_TOP = 10;
const NAVE_HEADROOM = 2;

const TITLE_WIDTH_RATIO = 0.95;
const LINEUP_WIDTH_RATIO = 0.94;
const TAGLINE_WIDTH_RATIO = 0.94;
const DATE_WIDTH_RATIO = 0.66;
const VENUE_WIDTH_RATIO = 0.52;

const TITLE_Z = 0.3;
const PLATE_Z = -0.35;

const UNIT_SIZE = 1;
const TITLE_NARROW = 0.72;
const TITLE_TRACKING = 0.12;
const TITLE_DEPTH = 0.16;
const TITLE_DEPTH_JITTER = 0.22;
const TITLE_BEVEL = 0.018;
const TITLE_BEVEL_SEGMENTS = 1;
const TITLE_CURVE_SEGMENTS = 2;
const TITLE_TILT = 0.022;
const TITLE_TILT_X = 0.03;
const TITLE_SPACE_ADVANCE = 0.32;

const BURN_FLAT = 0.94;
const BURN_EDGE = 0.2;

const CAP_SCALE = [0.28, 0.36, 0.46, 0.58, 0.72, 0.9];
const PLATE_TRACKING = 0.22;
// Дата и адрес набраны в разрядку клеймом по железу: строка мелким кеглем внизу читается
// подписью в углу листовки, а не отметкой на балке.
const MARK_TRACKING = 0.55;
// Готика плотнее гротеска и на разгоне разваливается на отдельные знаки, поэтому её строка
// набирается почти вплотную.
const GOTHIC_TRACKING = 0.06;
const PLATE_PAD_X = 0.3;
const PLATE_PAD_Y = 0.12;
const PLATE_DEPTH = 0.09;
const PLATE_RIM = 0.05;
const PLATE_FACE_RELIEF = 0.02;
const STENCIL_LIFT = 0.006;
// Порог ниже половины намеренно: с уменьшением плиты мипмап съедает тонкий штрих, и по
// строгому порогу мелкое имя рассыпается раньше, чем становится нечитаемым по кеглю.
const STENCIL_ALPHA_TEST = 0.38;
const RAGGED_SHIFT = 0.6;

const GAP_AFTER_TITLE = 0.26;
const GAP_AFTER_TAGLINE = 0.5;
const GAP_IN_LINEUP = 0.16;
const GAP_AFTER_LINEUP = 0.42;
const GAP_AFTER_DATE = 0.2;

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

const TITLE_EMISSIVE_BASE = 2.1;
// Жар не мигает в такт, а ползёт по фаске, как по остывающему прокату, и изредка срывается
// дугой: ровный пульс в бит читается дискотечной гирляндой, а не раскалённым железом.
const TITLE_HEAT_WAVES = 1.6;
const TITLE_HEAT_SECONDS = 14;
const TITLE_HEAT_LOW = 0.32;
const TITLE_HEAT_HIGH = 1.35;
const ARC_GAP_MIN = 2.4;
const ARC_GAP_MAX = 7;
const ARC_BLINK_MIN = 0.03;
const ARC_BLINK_MAX = 0.11;
const ARC_DEPTH_MIN = 0.18;
const ARC_DEPTH_MAX = 0.45;
const PLATE_EMISSIVE_BASE = 1.6;
// Блум берёт по яркости, а не по цвету: у крови её вдвое меньше, чем у кости, и красная
// плита не доходит до порога свечения. Множитель выравнивает именно это.
const EMISSIVE_LUMA_REFERENCE = 0.55;
const EMISSIVE_LUMA_BOOST_CAP = 2.2;
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

function facingTint(facing, tints) {
  if (facing > BURN_FLAT) return tints.flat;
  if (facing > BURN_EDGE) return tints.edge;
  return tints.wall;
}

/** Цвет вершины несёт и металл, и силу прожога: фаска кровь, стенки ржавчина, лицо железо. */
function paintBurn(geometry) {
  const normal = geometry.getAttribute('normal');
  const tints = {
    flat: new THREE.Color(PALETTE.iron),
    wall: new THREE.Color(PALETTE.rust),
    edge: new THREE.Color(PALETTE.blood),
  };
  const colors = new Float32Array(normal.count * 3);
  for (let i = 0; i < normal.count; i += 1) {
    const tint = facingTint(Math.abs(normal.getZ(i)), tints);
    colors[i * 3] = tint.r;
    colors[i * 3 + 1] = tint.g;
    colors[i * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/**
 * Эмиссия горит только по фаске (её гасит цвет вершины) и волной идёт вдоль строки.
 *
 * Волна живёт в шейдере, потому что она разная в каждой точке буквы: из JS такое пришлось бы
 * гнать отдельным материалом на каждую букву, то есть отдельным вызовом отрисовки.
 */
function burnEmissiveByVertexColor(material, span) {
  const heat = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHeat = heat;
    shader.uniforms.uSpan = { value: span };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHeatX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvHeatX = position.x;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeatX;\nuniform float uHeat;\nuniform float uSpan;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
\tfloat wave = 0.5 + 0.5 * sin(vHeatX / uSpan * ${TITLE_HEAT_WAVES.toFixed(2)} * 6.2831853 - uHeat);
\ttotalEmissiveRadiance *= vColor * mix(${TITLE_HEAT_LOW.toFixed(2)}, ${TITLE_HEAT_HIGH.toFixed(2)}, wave);`,
      );
  };
  return heat;
}

/** Дуга не мигает по расписанию: горит ровно, изредка срывается и снова садится на ток. */
function createArcFlicker(rng) {
  let nextAt = rng.range(ARC_GAP_MIN, ARC_GAP_MAX);
  let until = 0;
  let depth = 1;
  return function flicker(elapsed) {
    if (elapsed >= nextAt) {
      until = elapsed + rng.range(ARC_BLINK_MIN, ARC_BLINK_MAX);
      depth = rng.range(ARC_DEPTH_MIN, ARC_DEPTH_MAX);
      nextAt = until + rng.range(ARC_GAP_MIN, ARC_GAP_MAX);
    }
    return elapsed < until ? depth : 1;
  };
}

/** Насколько поднять эмиссию, чтобы цвет любой светлоты дотянулся до порога блума. */
function lumaBoost(color) {
  const { r, g, b } = new THREE.Color(color);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Math.min(EMISSIVE_LUMA_REFERENCE / luma, EMISSIVE_LUMA_BOOST_CAP);
}

function tiltLetter(geometry, halfWidth, rng) {
  geometry.translate(-halfWidth, -UNIT_SIZE / 2, 0);
  geometry.rotateZ(rng.range(-TITLE_TILT, TITLE_TILT));
  geometry.rotateX(rng.range(-TITLE_TILT_X, TITLE_TILT_X));
  geometry.translate(halfWidth, UNIT_SIZE / 2, 0);
}

function letterGeometry(font, glyph, rng) {
  return new TextGeometry(glyph, {
    font,
    size: UNIT_SIZE,
    depth: TITLE_DEPTH * rng.range(1 - TITLE_DEPTH_JITTER, 1 + TITLE_DEPTH_JITTER),
    curveSegments: TITLE_CURVE_SEGMENTS,
    bevelEnabled: true,
    bevelThickness: TITLE_BEVEL,
    bevelSize: TITLE_BEVEL,
    bevelOffset: 0,
    bevelSegments: TITLE_BEVEL_SEGMENTS,
  });
}

/**
 * Заголовок: буквы строятся поштучно, разводятся своим трекингом и только потом сливаются
 * в одну геометрию, иначе за каждую букву платили бы отдельным вызовом отрисовки.
 */
function createTitle({ text, rng, targetWidth }) {
  const font = new FontLoader().parse(GOTHIC_TYPEFACE);
  const trackingUnits = TITLE_TRACKING / TITLE_NARROW;
  const letters = [];
  let cursor = 0;

  for (const glyph of text) {
    const geometry = letterGeometry(font, glyph, rng);
    geometry.computeBoundingBox();
    const width = geometry.boundingBox.max.x - geometry.boundingBox.min.x;
    if (!(width > 0)) {
      geometry.dispose();
      cursor += UNIT_SIZE * TITLE_SPACE_ADVANCE + trackingUnits;
      continue;
    }
    paintBurn(geometry);
    geometry.translate(-geometry.boundingBox.min.x, 0, 0);
    tiltLetter(geometry, width / 2, rng);
    geometry.translate(cursor, 0, 0);
    letters.push(geometry);
    cursor += width + trackingUnits;
  }

  const merged = mergeGeometries(letters, false);
  for (const letter of letters) letter.dispose();
  merged.computeBoundingBox();

  const unitWidth = merged.boundingBox.max.x - merged.boundingBox.min.x;
  const scale = targetWidth / (unitWidth * TITLE_NARROW);
  const inkTop = merged.boundingBox.max.y * scale;
  // Строка меряется по всей краске, а не по высоте прописной: у текстура росчерк «A» уходит
  // под базовую линию и без этого лёг бы на первую плиту лайнапа.
  const inkHeight = inkTop - merged.boundingBox.min.y * scale;

  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    vertexColors: true,
    metalness: 0.95,
    roughness: 0.42,
    emissive: PALETTE.blood,
    emissiveIntensity: TITLE_EMISSIVE_BASE * lumaBoost(PALETTE.blood),
  });
  const heat = burnEmissiveByVertexColor(material, unitWidth);
  const flicker = createArcFlicker(rng);

  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.scale.set(scale * TITLE_NARROW, scale, scale);
  mesh.position.set(
    -targetWidth / 2 - merged.boundingBox.min.x * scale * TITLE_NARROW,
    -inkTop,
    TITLE_Z,
  );

  const group = new THREE.Group();
  group.add(mesh);
  return {
    group,
    height: inkHeight,
    burn(elapsed) {
      heat.value = (elapsed / TITLE_HEAT_SECONDS) * TAU;
      material.emissiveIntensity = TITLE_EMISSIVE_BASE * lumaBoost(PALETTE.blood) * flicker(elapsed);
    },
  };
}

/** Кегль подбирается по шкале: имена разной длины, а коробка одна. */
function fitCapHeight(text, { tracking, face, maxWidth }) {
  const widthPerCap = measureWidthPerCap(text, tracking, face);
  const usable = maxWidth - PLATE_PAD_X * 2;
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

function createPlate({
  text, maxWidth, capHeight, emissive, rng, shared,
  worn = false, face = NARROW_FACE, tracking = PLATE_TRACKING,
}) {
  const widthPerCap = measureWidthPerCap(text, tracking, face);
  const width = Math.min(maxWidth, capHeight * widthPerCap + PLATE_PAD_X * 2);
  const height = capHeight + PLATE_PAD_Y * 2;

  const stencil = createStencil({ width, height, rng, worn });
  stencil.paint(text, {
    face,
    tracking,
    capFraction: capHeight / height,
    padding: PLATE_PAD_X / width,
  });

  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.concrete,
    emissive,
    // Шкала кеглей не должна менять яркость строки: длинное имя садится на мелкий кегль,
    // его штрих тоньше и на экране гаснет, поэтому мелкая плита светит сильнее крупной.
    emissiveIntensity: PLATE_EMISSIVE_BASE * lumaBoost(emissive)
      * Math.min(PLATE_EMISSIVE_CAP / capHeight, PLATE_EMISSIVE_BOOST),
    alphaMap: stencil.texture,
    alphaTest: STENCIL_ALPHA_TEST,
    metalness: 0.6,
    roughness: 0.35,
  });

  const frontDepth = PLATE_DEPTH + PLATE_FACE_RELIEF;
  const front = slab(shared.box, shared.materials.face, width, height, frontDepth, PLATE_Z);
  const rim = slab(
    shared.box,
    shared.materials.rim,
    width + PLATE_RIM * 2,
    height + PLATE_RIM * 2,
    PLATE_DEPTH,
    PLATE_Z,
  );

  const stencilFace = slab(
    shared.plane,
    material,
    width,
    height,
    1,
    PLATE_Z + frontDepth / 2 + STENCIL_LIFT,
  );
  stencilFace.castShadow = false;

  const group = new THREE.Group();
  group.add(rim, front, stencilFace);
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
  const squeeze = gaps > 0 ? THREE.MathUtils.clamp((box.height - content) / gaps, 0, 1) : 1;
  let cursor = box.top - (box.height - content - gaps * squeeze) / 2;
  for (const item of rows) {
    item.row.group.position.y = cursor;
    cursor -= item.row.height + item.gap * squeeze;
  }
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
  };

  const title = createTitle({ text: event.event, rng, targetWidth: box.width * TITLE_WIDTH_RATIO });

  const taglineFit = { tracking: GOTHIC_TRACKING, face: GOTHIC_FACE, maxWidth: box.width * TAGLINE_WIDTH_RATIO };
  // Тэглайн необязателен: сцена собирается и без него, если строки нет в данных события.
  const tagline = event.tagline ? createPlate({
    text: event.tagline,
    maxWidth: taglineFit.maxWidth,
    capHeight: fitCapHeight(event.tagline, taglineFit),
    emissive: PALETTE.bone,
    rng,
    shared,
    face: GOTHIC_FACE,
    tracking: GOTHIC_TRACKING,
  }) : null;

  // Лайнап набирается одним кеглем по самому длинному имени: разный кегль читается рангом,
  // а ранга у этих имён нет, есть только разная длина ников.
  const lineupFit = { tracking: PLATE_TRACKING, face: NARROW_FACE, maxWidth: box.width * LINEUP_WIDTH_RATIO };
  const lineupCap = Math.min(...event.lineup.map((name) => fitCapHeight(name, lineupFit)));
  const lineup = event.lineup.map((name, index) => createPlate({
    text: name,
    maxWidth: lineupFit.maxWidth,
    capHeight: lineupCap,
    emissive: index === 0 ? PALETTE.blood : PALETTE.bone,
    rng,
    shared,
    // Потёртости живут только на именах: зал жуёт афишу, но дата и подпись обязаны читаться.
    worn: true,
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

  const rows = [
    { row: title, gap: GAP_AFTER_TITLE },
    // Тэглайн стоит подписью под названием, а не отдельной строкой внизу: он объясняет, что
    // это за вечер, и читается только рядом с тем, к чему относится.
    ...(tagline ? [{ row: tagline, gap: GAP_AFTER_TAGLINE }] : []),
    ...lineup.map((row, index) => ({
      row,
      gap: index < lineup.length - 1 ? GAP_IN_LINEUP : GAP_AFTER_LINEUP,
    })),
    { row: date, gap: GAP_AFTER_DATE },
    ...(venue ? [{ row: venue, gap: 0 }] : []),
  ];
  stackRows(rows, box);

  const countdown = createCountdown({ rng, todayLabel: event.todayLabel ?? DEFAULT_TODAY_LABEL });

  const group = new THREE.Group();
  for (const item of rows) group.add(item.row.group);
  group.add(countdown.mesh);

  const plates = [...(tagline ? [tagline] : []), ...lineup, date, ...(venue ? [venue] : [])];
  const beatOmega = TAU / BEAT.seconds;

  return {
    group,
    setDaysLeft(days) {
      countdown.show(days);
    },
    update(dt, elapsed) {
      title.burn(elapsed);

      for (const plate of plates) {
        const angle = elapsed * plate.sway.omega + plate.sway.phase;
        plate.group.rotation.z = plate.sway.amplitude * Math.sin(angle);
        plate.group.rotation.x = plate.sway.amplitude * SWAY_TILT_RATIO * Math.cos(angle);
      }

      if (!countdown.mesh.visible) return;
      const pulse = breath(elapsed, beatOmega);
      countdown.material.emissiveIntensity = COUNTDOWN_EMISSIVE_BASE + COUNTDOWN_EMISSIVE_SWING * pulse;
      countdown.mesh.scale.setScalar(1 + COUNTDOWN_PULSE * pulse);
    },
  };
}
