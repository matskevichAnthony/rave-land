/**
 * Воздух нефа и коридора: искры от углей, слои дымки и лучи света.
 *
 * Это не геометрия зала, а то, что между ней стоит, поэтому файл отдельный. Механика
 * общая и живёт в `src/procedural`, здесь остаются только метры сцены: габариты нефа,
 * коробка типографики и направление ключевого света. Каждая сущность стоит ровно один
 * вызов отрисовки: одна система точек на все очаги, один инстанс на все слои дымки, один
 * на все конусы света. Коридор въезжает в те же три сущности, а не заводит свои.
 */

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { CORRIDOR, KEY_LIGHT, NAVE, ROSE, TYPE_BOX } from './nave.js';
import { buildInstanced } from '../procedural/instancing.js';
import { softenMaterial } from '../render/depth-probe.js';
import { createBlobTexture } from '../procedural/canvas-texture.js';
import { openBandY } from '../procedural/shapes.js';
import { createSparks as createSparkSystem } from '../procedural/sparks.js';

const UP = new THREE.Vector3(0, 1, 0);

const SPARKS = {
  count: 900,
  size: 26,
  jitter: 0.26,
  rise: [3.4, 11],
  drift: [0.2, 0.9],
  speed: [0.045, 0.16],
  // Искра размером с уголёк, и гаснуть ей есть смысл только вплотную к камню: порог в метры
  // съел бы её у самой жаровни, над которой она и живёт.
  fade: 0.3,
};

const HAZE = {
  layers: 7,
  texture: 256,
  blobs: 90,
  blobRadius: [0.06, 0.3],
  blobAlpha: [0.04, 0.16],
  width: 34,
  height: 26,
  farZ: -24,
  nearZ: 8,
  clearance: 1.6,
  opacity: 0.075,
  tint: [0.35, 1],
  warmth: 0.55,
  scroll: 0.006,
  drift: 0.9,
  driftSpeed: 0.07,
  // Метр это ширина шва, а не глубина воздуха: плоскость входит в пол и в колонны под
  // острым углом, и метра хватает, чтобы линия среза расплылась. Порог в два и больше
  // снимает уже не шов, а весь тёплый налёт над полом, ради которого дымка и стоит.
  fade: 1,
};

const RAY = {
  cones: [1, 0.62, 0.3],
  brightness: [0.4, 0.7, 1],
  flare: 1.35,
  segments: 16,
  opacity: 0.06,
  breath: 0.35,
  // Дальнее кольцо самого широкого конуса шире восьми метров и наклонено к полу, поэтому
  // луч гасится сильно раньше коробки типографики: иначе его край заедет в текст.
  clearance: 4.4,
  // Конус входит в пол и в пилястры под углом, и на срезе стоит жестяная кромка. Полтора
  // метра растворяют её в пятно света на камне, не съедая сам столб.
  fade: 1.5,
};

/**
 * Воздух коридора начинается за точкой съёмки афиши.
 *
 * Камера кадра афиши стоит на двадцати шести метрах и смотрит в зал, поэтому всё, что
 * ближе, попадает не в коридор, а прямо в постер. Дымка, лучи и угольки коридора живут
 * дальше этой отметки, и ни один прежний кадр зала от них не меняется.
 */
const AIR = { startZ: 30 };

/**
 * Дымка стоит только в ближней к залу половине коридора.
 *
 * Слой альфы гасит собой всё, что за ним, включая сам зал в глубине кадра: расставленная
 * до дальнего конца дымка не топила его, а ровно приглушала весь пролёт. Дальний конец
 * топит туман сцены, а дымка делает своё дело, наливая тёплый воздух у портала.
 */
const CORRIDOR_HAZE = {
  layers: 6,
  width: 14,
  height: 11,
  y: 4.4,
  drift: 1.6,
  endZ: 78,
  glow: [0.12, 1.3],
  falloff: 1.6,
  warmth: 0.5,
};

// Лучи падают у самых колонн, а не в середину пролёта: по середине идёт камера, и столб
// света, сквозь который она пролетает, читается не лучом, а серой заслонкой на пол-кадра.
const CORRIDOR_RAY = {
  everyBays: 3,
  x: 5.4,
  top: 11.5,
  slant: 1.6,
  radius: 0.34,
  // Ядро в широком ореоле: один конус постоянной яркости читается жестяной заслонкой, а
  // пара вложенных даёт спад от середины луча к его краю.
  cones: [1, 2.2],
  core: [1, 0.3],
  glow: [0.06, 0.8],
  falloff: 2.2,
};

// Угольки коридора тлеют у подножия пилястр: конкретные жаровни ставит архитектура, здесь
// известны только линия стены и шаг пролёта, по которому идёт весь ритм коридора.
const CORRIDOR_EMBER = { everyBays: 4, x: 5.9, y: 0.5 };

/** Доля света на глубине коридора: единица у портала, `far` в дальнем конце. */
function arriving([far, near], nearness, falloff) {
  return far + (near - far) * nearness ** falloff;
}

/** Отметки вдоль коридора по сетке пролётов: воздух держит ритм арок, а не свой шаг. */
function corridorStations(everyBays) {
  const first = NAVE.frontZ + CORRIDOR.span;
  const start = first + Math.ceil((AIR.startZ - first) / CORRIDOR.span) * CORRIDOR.span;
  const stations = [];
  for (let z = start; z <= CORRIDOR.farZ; z += CORRIDOR.span * everyBays) stations.push(z);
  return stations;
}

function nearHall(z) {
  return 1 - (z - AIR.startZ) / (CORRIDOR.farZ - AIR.startZ);
}

function corridorEmbers() {
  const spots = [];
  for (const z of corridorStations(CORRIDOR_EMBER.everyBays)) {
    spots.push([-CORRIDOR_EMBER.x, CORRIDOR_EMBER.y, z], [CORRIDOR_EMBER.x, CORRIDOR_EMBER.y, z]);
  }
  return spots;
}

/**
 * Искры над углями зала и коридора: числа подобраны под высоту свода, механика общая.
 *
 * Частицы раздаются очагам по кругу, поэтому вместе с новыми очагами растёт и счёт: на
 * прежнем счёте коридор забрал бы искры у бочек алтаря, а зал обязан гореть как раньше.
 */
export function createSparks({ rng, sources }) {
  const origins = [...sources, ...corridorEmbers()];
  const sparks = createSparkSystem({
    random: rng,
    sources: origins,
    count: Math.round((SPARKS.count * origins.length) / sources.length),
    size: SPARKS.size,
    jitter: SPARKS.jitter,
    rise: SPARKS.rise,
    drift: SPARKS.drift,
    speed: SPARKS.speed,
    hot: PALETTE.emberHalo,
    cold: PALETTE.ember,
  });
  softenMaterial(sparks.object.material, SPARKS.fade);
  return sparks;
}

function hazeDepth(index, rng) {
  const span = HAZE.nearZ - HAZE.farZ;
  const z = HAZE.farZ + (span * (index + 0.5)) / HAZE.layers + rng.range(-1, 1);
  const keepOut = TYPE_BOX.depth / 2 + HAZE.clearance;
  if (Math.abs(z - TYPE_BOX.z) >= keepOut) return z;
  return TYPE_BOX.z + Math.sign(z - TYPE_BOX.z || -1) * keepOut;
}

function smoke(warmth, level) {
  return new THREE.Color(PALETTE.moon).lerp(new THREE.Color(PALETTE.ember), warmth)
    .multiplyScalar(level);
}

/** Слои зала: ближние держат тёплый оттенок углей и приглушены, иначе замыливают розу. */
function planHallHaze(rng) {
  const layers = [];
  for (let index = 0; index < HAZE.layers; index += 1) {
    const x = rng.range(-2, 2);
    const z = hazeDepth(index, rng);
    const width = HAZE.width * rng.range(0.9, 1.25);
    const height = HAZE.height * rng.range(0.8, 1.1);
    const nearness = index / (HAZE.layers - 1);
    layers.push({
      x,
      y: HAZE.height / 2 - 2,
      z,
      width,
      height,
      tint: smoke(
        nearness * HAZE.warmth,
        HAZE.tint[0] + (HAZE.tint[1] - HAZE.tint[0]) * (1 - nearness),
      ),
    });
  }
  return layers;
}

/**
 * Слои коридора: у портала густой тёплый воздух, к дальнему концу почти ничего.
 *
 * Плоскости стоят вдвое реже зальных и по ширине пролёта: камера летит сквозь них, и
 * частый ряд читался бы миганием, а не воздухом.
 */
function planCorridorHaze(rng) {
  const layers = [];
  for (let index = 0; index < CORRIDOR_HAZE.layers; index += 1) {
    const along = (index + 0.5) / CORRIDOR_HAZE.layers;
    const z = AIR.startZ + (CORRIDOR_HAZE.endZ - AIR.startZ) * along
      + rng.range(-CORRIDOR_HAZE.drift, CORRIDOR_HAZE.drift);
    const nearness = nearHall(z);
    layers.push({
      x: rng.range(-1.5, 1.5),
      y: CORRIDOR_HAZE.y,
      z,
      width: CORRIDOR_HAZE.width * rng.range(0.85, 1.15),
      height: CORRIDOR_HAZE.height * rng.range(0.8, 1.15),
      tint: smoke(
        nearness * CORRIDOR_HAZE.warmth,
        arriving(CORRIDOR_HAZE.glow, nearness, CORRIDOR_HAZE.falloff),
      ),
    });
  }
  return layers;
}

/**
 * Слоистая дымка: несколько альфа-плоскостей вместо честного объёма.
 *
 * Инстансы уложены от дальнего к ближнему: внутри одного вызова отрисовки порядок
 * примитивов и есть порядок смешивания, а камера сцены всегда стоит со стороны +Z.
 * Коридор продолжает тот же ряд дальше по Z и тем же инстансом.
 */
export function createHaze({ rng }) {
  const material = softenMaterial(new THREE.MeshBasicMaterial({
    map: createBlobTexture({
      random: rng,
      size: HAZE.texture,
      blobs: HAZE.blobs,
      radius: HAZE.blobRadius,
      alpha: HAZE.blobAlpha,
    }),
    transparent: true,
    opacity: HAZE.opacity,
    depthWrite: false,
    fog: false,
  }), HAZE.fade);

  const layers = [...planHallHaze(rng), ...planCorridorHaze(rng)];
  const mesh = buildInstanced(
    new THREE.PlaneGeometry(1, 1),
    material,
    layers.length,
    (layer, index) => {
      const plan = layers[index];
      layer.position.set(plan.x, plan.y, plan.z);
      layer.scale.set(plan.width, plan.height, 1);
    },
    (tint, index) => tint.copy(layers[index].tint),
  );
  mesh.frustumCulled = false;

  return {
    object: mesh,
    update(elapsed) {
      material.map.offset.x = elapsed * HAZE.scroll;
      mesh.position.x = Math.sin(elapsed * HAZE.driftSpeed) * HAZE.drift;
    },
  };
}

/** Столб света от точки к точке: узкий конец наверху, у щели, широкий на полу. */
function planShaft(top, floor, width, brightness) {
  return {
    center: top.clone().add(floor).multiplyScalar(0.5),
    lift: new THREE.Quaternion().setFromUnitVectors(UP, top.clone().sub(floor).normalize()),
    width,
    length: top.distanceTo(floor),
    brightness,
  };
}

/**
 * Луч из розы: три вложенных конуса вдоль направления ключевого света.
 *
 * Луч упирается в воздух перед коробкой типографики, потому что дальше начинается текст,
 * и перекрывать его аддитивной плоскостью нечем.
 */
function planRoseRay(rng) {
  const from = new THREE.Vector3(...KEY_LIGHT.from);
  const to = new THREE.Vector3(...KEY_LIGHT.to);
  const direction = to.clone().sub(from).normalize();
  const start = new THREE.Vector3(0, ROSE.y, NAVE.endZ);
  const travel = (TYPE_BOX.z - TYPE_BOX.depth / 2 - RAY.clearance - NAVE.endZ) / direction.z;
  const end = start.clone().addScaledVector(direction, travel);
  return RAY.cones.map((share, index) => planShaft(
    start,
    end,
    ROSE.radius * share * rng.range(0.92, 1.08),
    RAY.brightness[index],
  ));
}

/**
 * Поперечные лучи коридора: свет падает наклонно, через пролёт, попеременно с двух сторон.
 *
 * Ритм важнее правдоподобия источника: на пролёте камера проходит луч примерно раз в
 * секунду, и коридор перестаёт быть чёрной трубой без единой отметки глубины.
 */
function planCorridorRays() {
  return corridorStations(CORRIDOR_RAY.everyBays).flatMap((z, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const top = new THREE.Vector3(side * CORRIDOR_RAY.x, CORRIDOR_RAY.top, z);
    const floor = new THREE.Vector3(side * (CORRIDOR_RAY.x - CORRIDOR_RAY.slant), 0, z);
    const level = arriving(CORRIDOR_RAY.glow, nearHall(z), CORRIDOR_RAY.falloff);
    return CORRIDOR_RAY.cones.map((share, cone) => planShaft(
      top,
      floor,
      CORRIDOR_RAY.radius * share,
      level * CORRIDOR_RAY.core[cone],
    ));
  });
}

/** Все столбы света сцены одним инстансом: у них одна форма, один материал и одно дыхание. */
export function createGodRay({ rng }) {
  const shafts = [...planRoseRay(rng), ...planCorridorRays()];

  const material = softenMaterial(new THREE.MeshBasicMaterial({
    color: PALETTE.moon,
    transparent: true,
    opacity: RAY.opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
  }), RAY.fade);

  const mesh = buildInstanced(
    openBandY({ bottom: RAY.flare, segments: RAY.segments }),
    material,
    shafts.length,
    (cone, index) => {
      const shaft = shafts[index];
      cone.position.copy(shaft.center);
      cone.quaternion.copy(shaft.lift);
      cone.scale.set(shaft.width, shaft.length, shaft.width);
    },
    (tint, index) => tint.setScalar(shafts[index].brightness),
  );
  mesh.frustumCulled = false;

  return {
    object: mesh,
    update(pulse) {
      material.opacity = RAY.opacity * (1 + RAY.breath * pulse);
    },
  };
}
