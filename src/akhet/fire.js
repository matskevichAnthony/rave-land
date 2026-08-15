/**
 * Огонь площадки: жаровни у подножий, костры вдоль аллеи и всё, что от них остаётся.
 *
 * Днём огонь виден не свечением. Солнце в пятидесяти шести градусах пересиливает любое
 * пламя, поэтому очаг в этом кадре читается по трём вещам: столб дыма, который уходит
 * выше фигуры и рвёт её силуэт, тёмное пятно копоти на песке и искры над чашей. Само
 * пламя оставлено маленьким и сложенным по свету: его дело подсветить края чаши, а не
 * осветить сцену. Своего источника света огонь не заводит ни одного, бюджет кадра занят
 * солнцем, небом и ядром вихря.
 *
 * Все очаги собраны инстансами: сколько бы их ни поставила площадка, кадру они стоят пять
 * вызовов отрисовки, из которых один это общая система искр.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';
import { createSparks } from '../procedural/sparks.js';
import { buildInstanced } from '../procedural/instancing.js';
import { between } from '../procedural/random.js';

const BOWL = { radius: 0.66, foot: 0.38, depth: 0.44, stemTop: 0.24, stemFoot: 0.42, sides: 10 };
const STEM = 0.84;

/**
 * Пламя короткое намеренно.
 *
 * Высокий язык в полдень читается оранжевой тряпкой: он ярче песка, но не ярче неба, и
 * кадр получает пятно без формы. Метр с небольшим над чашей держится в пределах силуэта
 * жаровни, а работу «тут горит» делает дым.
 */
const FLAME = {
  radius: 0.46,
  height: 1.5,
  sides: 8,
  opacity: 0.82,
  flicker: 0.16,
  beat: [2.4, 4.6],
};

const SMOKE = {
  width: 3.6,
  height: 12,
  lift: 1.1,
  opacity: 0.28,
  scroll: 0.026,
  tiles: 2,
  lean: 0.34,
};

const DRIFT = { blobs: 26, radius: [0.1, 0.34], level: [0.35, 0.9] };

const SOOT = { radius: 2.4, lift: 0.04, opacity: 0.52 };

const clamp01 = (value) => Math.min(1, Math.max(0, value));

const SPARKS = {
  count: 200,
  size: 18,
  jitter: 0.3,
  rise: [2.4, 7],
  drift: [0.2, 1.1],
  speed: [0.07, 0.24],
};

/**
 * Жаровня у подножия фигуры: отступ считается от её роста.
 *
 * Очаг стоит перед фигурой и чуть в стороне от дороги: перед ней потому, что дым обязан
 * идти по силуэту, а не за ним, в стороне потому, что по дороге ходят.
 */
const FOOT = { gap: 1.6, share: 0.1, cap: 4, aside: 0.35, scale: 1.35 };

export function footHearth({ x, z, height }) {
  const reach = Math.min(FOOT.cap, FOOT.gap + height * FOOT.share);
  return {
    x: x + Math.sign(x) * reach * FOOT.aside,
    z: z + reach,
    scale: FOOT.scale,
  };
}

/** Полоса яркости по высоте: чем ниже, тем плотнее. Каналом альфа-карты идёт зелёный. */
function verticalFade(stops) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const band = ctx.createLinearGradient(0, canvas.height, 0, 0);
  for (const [at, level] of stops) {
    const value = Math.round(level * 255);
    band.addColorStop(at, `rgb(${value}, ${value}, ${value})`);
  }
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, 1, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

/**
 * Клубы дыма серым по чёрному, сходящиеся сами с собой по краям.
 *
 * Пятна кладутся сложением поверх непрозрачного чёрного, а не прозрачностью: альфа-карта
 * читается зелёным каналом, а у пятна, нарисованного прозрачностью, зелёный остаётся
 * полным до самого края, и мягкий клуб выходит жёстким блином.
 */
function createDriftTexture(rng) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  for (let index = 0; index < DRIFT.blobs; index += 1) {
    const radius = between(rng, ...DRIFT.radius) * size;
    const level = between(rng, ...DRIFT.level);
    const x = rng() * size;
    const y = rng() * size;
    for (const wrapX of [-size, 0, size]) {
      for (const wrapY of [-size, 0, size]) {
        const blob = ctx.createRadialGradient(
          x + wrapX, y + wrapY, 0,
          x + wrapX, y + wrapY, radius,
        );
        blob.addColorStop(0, `rgba(255, 255, 255, ${level})`);
        blob.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = blob;
        ctx.fillRect(x + wrapX - radius, y + wrapY - radius, radius * 2, radius * 2);
      }
    }
  }
  return new THREE.CanvasTexture(canvas);
}

/** Круглое пятно с мягким краем: копоть под очагом. */
function radialFade() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const spot = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  spot.addColorStop(0, '#ffffff');
  spot.addColorStop(0.45, '#c8c8c8');
  spot.addColorStop(1, '#000000');
  ctx.fillStyle = spot;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function createBrazier() {
  const stem = new THREE.CylinderGeometry(BOWL.stemTop, BOWL.stemFoot, STEM, BOWL.sides)
    .translate(0, STEM / 2, 0);
  const bowl = new THREE.CylinderGeometry(BOWL.radius, BOWL.foot, BOWL.depth, BOWL.sides)
    .translate(0, STEM + BOWL.depth / 2, 0);
  return mergeGeometries([stem, bowl]);
}

/** Высота, на которой лежат угли: от неё считают искры и пламя. */
const COALS = STEM + BOWL.depth * 0.7;

function createFlame() {
  return new THREE.ConeGeometry(FLAME.radius, FLAME.height, FLAME.sides, 1, true)
    .translate(0, COALS + FLAME.height / 2, 0);
}

/**
 * Столб дыма: две скрещенные полосы с гашением по вершинам.
 *
 * Гашение положено в вершинный цвет, а не в карту: карта дыму нужна ползущая, и если
 * запечь в неё же затухание, то вверх поедет и оно, а столб обязан таять всегда на одной
 * высоте. Полосы скрещены, потому что камера обходит площадку кругом, а одна плоскость с
 * торца пропадает.
 */
function createPlume() {
  const panel = new THREE.PlaneGeometry(SMOKE.width, SMOKE.height, 2, 6)
    .translate(0, SMOKE.height / 2 + SMOKE.lift, 0);
  const position = panel.attributes.position;
  const shade = new Float32Array(position.count * 4);
  // Доли зажаты намеренно: вершины лежат в буфере одинарной точности, верхний край даёт долю
  // чуть больше единицы, а дробная степень отрицательного это NaN. Такая альфа уезжает в буфер
  // кадра, свечение размазывает её по всему экрану, и картинка чернеет без единой ошибки.
  for (let index = 0; index < position.count; index += 1) {
    const up = clamp01((position.getY(index) - SMOKE.lift) / SMOKE.height);
    const edge = clamp01(1 - Math.abs(position.getX(index)) / (SMOKE.width / 2));
    position.setX(index, position.getX(index) * (0.45 + up));
    position.setZ(index, position.getZ(index) + up * up * SMOKE.height * SMOKE.lean);
    shade.set([1, 1, 1, Math.min(1, up * 5) * (1 - up) ** 1.4 * edge], index * 4);
  }
  panel.setAttribute('color', new THREE.BufferAttribute(shade, 4));
  return mergeGeometries([panel, panel.clone().rotateY(Math.PI / 2)]);
}

function createSoot() {
  return new THREE.CircleGeometry(SOOT.radius, 16).rotateX(-Math.PI / 2);
}

/**
 * Огонь на всех очагах площадки.
 *
 * `hearths` это список мест с масштабом: большие очаги стоят у фигур, мелкие вдоль
 * дороги. Материал камня приходит от сцены, свои цвета огонь берёт из палитры.
 */
export function createFire({ rng, dunes, material, hearths }) {
  const group = new THREE.Group();
  const spots = hearths.map((hearth) => ({
    ...hearth,
    y: dunes.heightAt(hearth.x, hearth.z),
    turn: rng() * Math.PI * 2,
    phase: rng() * Math.PI * 2,
    beat: between(rng, ...FLAME.beat),
  }));

  const stand = (draft, index) => {
    const spot = spots[index];
    draft.position.set(spot.x, spot.y, spot.z);
    draft.rotation.y = spot.turn;
    draft.scale.setScalar(spot.scale);
  };

  const braziers = buildInstanced(createBrazier(), material, spots.length, stand);
  braziers.castShadow = true;
  braziers.receiveShadow = true;

  const flames = buildInstanced(
    createFlame(),
    new THREE.MeshBasicMaterial({
      color: PALETTE.ember,
      alphaMap: verticalFade([[0, 1], [0.4, 0.8], [1, 0]]),
      transparent: true,
      opacity: FLAME.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
    spots.length,
    stand,
  );

  const drift = createDriftTexture(rng);
  drift.wrapS = THREE.RepeatWrapping;
  drift.wrapT = THREE.RepeatWrapping;
  drift.repeat.set(1, SMOKE.tiles);

  const smoke = buildInstanced(
    createPlume(),
    new THREE.MeshBasicMaterial({
      color: PALETTE.smoke,
      alphaMap: drift,
      vertexColors: true,
      transparent: true,
      opacity: SMOKE.opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    spots.length,
    stand,
  );
  smoke.renderOrder = 2;

  const soot = buildInstanced(
    createSoot(),
    new THREE.MeshBasicMaterial({
      color: PALETTE.soot,
      alphaMap: radialFade(),
      transparent: true,
      opacity: SOOT.opacity,
      depthWrite: false,
    }),
    spots.length,
    (draft, index) => {
      const spot = spots[index];
      draft.position.set(spot.x, spot.y + SOOT.lift, spot.z);
      draft.rotation.y = spot.turn;
      draft.scale.set(spot.scale, 1, spot.scale);
    },
  );

  const sparks = createSparks({
    random: rng,
    sources: spots.map((spot) => [spot.x, spot.y + COALS * spot.scale, spot.z]),
    count: SPARKS.count,
    size: SPARKS.size,
    jitter: SPARKS.jitter,
    rise: SPARKS.rise,
    drift: SPARKS.drift,
    speed: SPARKS.speed,
    hot: PALETTE.ember,
    cold: PALETTE.emberDeep,
  });
  sparks.object.renderOrder = 3;

  group.add(soot, braziers, flames, smoke, sparks.object);

  const draft = new THREE.Object3D();

  /** Дрожь пламени идёт по каждому очагу отдельно: общий пульс читается миганием гирлянды. */
  function update(elapsed) {
    for (let index = 0; index < spots.length; index += 1) {
      const spot = spots[index];
      const beat = Math.sin(elapsed * spot.beat + spot.phase);
      draft.position.set(spot.x, spot.y, spot.z);
      draft.rotation.set(0, spot.turn, 0);
      draft.scale.set(
        spot.scale * (1 - beat * FLAME.flicker * 0.5),
        spot.scale * (1 + beat * FLAME.flicker),
        spot.scale * (1 - beat * FLAME.flicker * 0.5),
      );
      draft.updateMatrix();
      flames.setMatrixAt(index, draft.matrix);
    }
    flames.instanceMatrix.needsUpdate = true;
    drift.offset.y = -elapsed * SMOKE.scroll;
    sparks.update(elapsed);
  }

  return { group, update };
}
