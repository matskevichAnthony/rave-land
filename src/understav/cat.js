/**
 * Кот нефа UNDERSTAV: единственное живое существо в кадре.
 *
 * Весь зверь стоит четыре вызова отрисовки: корпус, конечности с хвостом, уши и глаза,
 * каждая пачка одинаковых частей одним `InstancedMesh`. Шерсть держит цвет пустоты и
 * железа, поэтому кот читается силуэтом на просвет, а не пятном.
 *
 * Походка выведена из круга, а не подобрана на глаз: круг делится на целое число шагов,
 * стопа стоит на полу ровно ту долю цикла, что тело проезжает её шагом, и потому кот
 * не скользит по полу и не дёргается на стыке оборота.
 */

import * as THREE from 'three';
import { BEAT, PALETTE } from './palette.js';

const TAU = Math.PI * 2;
const HALF = 0.5;

const scratch = new THREE.Object3D();
scratch.rotation.order = 'YXZ';

const SIDES = [-1, 1];

const FUR_COLORS = [PALETTE.void, PALETTE.iron];
const EYE_COLORS = [PALETTE.ember, PALETTE.trip];

const FUR = { roughness: 0.94, metalness: 0.08 };

const WALK = {
  radius: 8,
  step: 0.42,
  cadence: [1.3, 1.8],
  duty: 0.62,
  lift: 0.07,
  bob: 0.014,
  bobRate: 2,
  roll: 0.028,
};

const TORSO = { y: 0.46, z: 0, width: 0.26, height: 0.24, length: 0.58, tilt: 0 };
const CHEST = { y: 0.47, z: 0.27, width: 0.28, height: 0.26, length: 0.24, tilt: -0.05 };
const HAUNCH = { y: 0.48, z: -0.26, width: 0.3, height: 0.28, length: 0.26, tilt: 0.05 };
const NECK = { y: 0.55, z: 0.36, width: 0.16, height: 0.16, length: 0.2, tilt: -0.46 };
const HEAD = { y: 0.6, z: 0.46, width: 0.21, height: 0.19, length: 0.22, tilt: 0 };
const MUZZLE = { y: 0.565, z: 0.585, width: 0.12, height: 0.09, length: 0.1, tilt: 0 };
const BODY_PARTS = [TORSO, CHEST, HAUNCH, NECK, HEAD, MUZZLE];

const LEG = {
  hip: 0.36,
  thigh: 0.21,
  shin: 0.2,
  thighWidth: 0.085,
  shinWidth: 0.062,
  spread: 0.105,
  frontZ: 0.24,
  backZ: -0.24,
  slack: 0.02,
};

const PAW = { width: 0.085, height: 0.05, length: 0.12, reach: 0.02 };

/** Локоть передней лапы смотрит назад, колено задней вперёд: без этого кот идёт как стол. */
const KNEE = { front: 1, back: -1 };

const GAIT = [
  { side: -1, front: false, phase: 0 },
  { side: -1, front: true, phase: 0.25 },
  { side: 1, front: false, phase: 0.5 },
  { side: 1, front: true, phase: 0.75 },
];

const PARTS_PER_LEG = 3;
const TAIL_SLOT = GAIT.length * PARTS_PER_LEG;

const TAIL = {
  count: [5, 7],
  y: 0.52,
  z: -0.36,
  segment: 0.07,
  thick: [0.055, 0.022],
  pitch: 1.85,
  curl: 0.16,
  lash: 0.12,
  sway: 0.55,
  speed: 1.7,
  curlSpeed: 0.85,
  lag: 0.5,
};

const EAR = {
  sides: 3,
  spread: 0.075,
  y: 0.685,
  z: 0.44,
  width: 0.062,
  height: 0.13,
  depth: 0.03,
  tilt: -0.1,
  turn: 0.5,
  flare: 0.28,
};

const EYE = { spread: 0.062, y: 0.625, z: 0.55, width: 0.032, height: 0.026, depth: 0.03 };

const BLINK = { period: 4.6, close: 0.17, narrow: 0.08 };

const GLOW = { base: 2.8, swing: 0.6 };

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Угол треугольника между сторонами `near` и `span`, напротив стороны `far`. */
function jointAngle(near, span, far) {
  const cosine = (near * near + span * span - far * far) / (2 * near * span);
  return Math.acos(clamp(cosine, -1, 1));
}

function placeSegment(mesh, slot, x, y, z, pitch, yaw, thickness, length) {
  scratch.position.set(x, y, z);
  scratch.rotation.set(pitch, yaw, 0);
  scratch.scale.set(thickness, length, thickness);
  scratch.updateMatrix();
  mesh.setMatrixAt(slot, scratch.matrix);
}

// Стопа считается по верху лапки: иначе угол голени вылезает из неё под пол.
function placePaw(mesh, slot, x, y, z) {
  scratch.position.set(x, y - PAW.height * HALF, z + PAW.reach);
  scratch.rotation.set(0, 0, 0);
  scratch.scale.set(PAW.width, PAW.height, PAW.length);
  scratch.updateMatrix();
  mesh.setMatrixAt(slot, scratch.matrix);
}

/**
 * Круг, шаг и угловая скорость.
 *
 * Число шагов на оборот округляется до целого, и уже из него берётся длина шага: тогда
 * фаза походки завязана прямо на угол, и оборот сходится сам, без стыка.
 */
function planWalk(rng, radius) {
  const steps = Math.max(1, Math.round((TAU * radius) / WALK.step));
  const cadence = rng.range(...WALK.cadence);
  return {
    radius,
    steps,
    stride: (TAU * radius) / steps,
    start: rng() * TAU,
    spin: (TAU * cadence) / steps,
  };
}

function planLegs(walk) {
  return GAIT.map((leg) => {
    const x = leg.side * LEG.spread;
    return {
      x,
      z: leg.front ? LEG.frontZ : LEG.backZ,
      phase: leg.phase,
      knee: leg.front ? KNEE.front : KNEE.back,
      // Внешняя лапа идёт по кругу большего радиуса, и шаг у неё во столько же длиннее.
      stride: walk.stride * (1 + x / walk.radius),
    };
  });
}

function createMaterials(rng) {
  return {
    fur: new THREE.MeshStandardMaterial({
      color: rng.pick(FUR_COLORS),
      roughness: FUR.roughness,
      metalness: FUR.metalness,
      flatShading: true,
    }),
    eye: new THREE.MeshStandardMaterial({
      color: PALETTE.void,
      emissive: rng.pick(EYE_COLORS),
      emissiveIntensity: GLOW.base,
      roughness: 1,
    }),
  };
}

function buildTrunk(geometry, material) {
  const mesh = new THREE.InstancedMesh(geometry, material, BODY_PARTS.length);
  for (let index = 0; index < BODY_PARTS.length; index += 1) {
    const part = BODY_PARTS[index];
    scratch.position.set(0, part.y, part.z);
    scratch.rotation.set(part.tilt, 0, 0);
    scratch.scale.set(part.width, part.height, part.length);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  return mesh;
}

function buildEars(material) {
  const geometry = new THREE.ConeGeometry(1, 1, EAR.sides);
  const mesh = new THREE.InstancedMesh(geometry, material, SIDES.length);
  for (let index = 0; index < SIDES.length; index += 1) {
    const side = SIDES[index];
    scratch.position.set(side * EAR.spread, EAR.y, EAR.z);
    scratch.rotation.set(EAR.tilt, side * EAR.turn, -side * EAR.flare);
    scratch.scale.set(EAR.width, EAR.height, EAR.depth);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  return mesh;
}

/**
 * Одна лапа: стопа ведётся по земле, а сустав считается обратной кинематикой.
 *
 * Пока лапа опорная, стопа уезжает назад ровно со скоростью тела, поэтому проскальзывания
 * нет по построению. Перенос идёт циклоидой: на касании и на отрыве скорость стопы
 * относительно пола нулевая, и лапа не подсекает.
 */
function placeLeg(mesh, index, leg, gait, footBase) {
  const cycle = gait + leg.phase;
  const phase = cycle - Math.floor(cycle);
  const swing = Math.max(0, (phase - WALK.duty) / (1 - WALK.duty));
  const carried = leg.stride * (swing - Math.sin(TAU * swing) / TAU);

  const footZ = leg.stride * (WALK.duty * HALF - phase) + carried;
  const footY = footBase + WALK.lift * HALF * (1 - Math.cos(TAU * swing));

  const span = Math.min(Math.hypot(footZ, footY), LEG.thigh + LEG.shin - LEG.slack);
  const aim = Math.atan2(-footZ, -footY);
  const thigh = aim + leg.knee * jointAngle(LEG.thigh, span, LEG.shin);
  const shin = aim - leg.knee * jointAngle(LEG.shin, span, LEG.thigh);

  const kneeY = LEG.hip - Math.cos(thigh) * LEG.thigh;
  const kneeZ = leg.z - Math.sin(thigh) * LEG.thigh;
  const toeY = kneeY - Math.cos(shin) * LEG.shin;
  const toeZ = kneeZ - Math.sin(shin) * LEG.shin;

  const slot = index * PARTS_PER_LEG;
  placeSegment(
    mesh, slot,
    leg.x, (LEG.hip + kneeY) * HALF, (leg.z + kneeZ) * HALF,
    thigh, 0, LEG.thighWidth, LEG.thigh,
  );
  placeSegment(
    mesh, slot + 1,
    leg.x, (kneeY + toeY) * HALF, (kneeZ + toeZ) * HALF,
    shin, 0, LEG.shinWidth, LEG.shin,
  );
  placePaw(mesh, slot + 2, leg.x, toeY, toeZ);
}

/** Хвост: цепочка сегментов, каждый растёт из конца прошлого, поэтому нигде не рвётся. */
function placeTail(mesh, count, elapsed) {
  let x = 0;
  let y = TAIL.y;
  let z = TAIL.z;
  for (let index = 0; index < count; index += 1) {
    const along = (index + 1) / count;
    const pitch = TAIL.pitch + TAIL.curl * index
      + Math.sin(elapsed * TAIL.curlSpeed - index * TAIL.lag) * TAIL.lash * along;
    const yaw = Math.sin(elapsed * TAIL.speed - index * TAIL.lag) * TAIL.sway * along;
    const flat = -Math.sin(pitch);
    const stepX = flat * Math.sin(yaw);
    const stepY = -Math.cos(pitch);
    const stepZ = flat * Math.cos(yaw);
    const thickness = TAIL.thick[0] + (TAIL.thick[1] - TAIL.thick[0]) * along;

    placeSegment(
      mesh, TAIL_SLOT + index,
      x + stepX * TAIL.segment * HALF,
      y + stepY * TAIL.segment * HALF,
      z + stepZ * TAIL.segment * HALF,
      pitch, yaw, thickness, TAIL.segment,
    );

    x += stepX * TAIL.segment;
    y += stepY * TAIL.segment;
    z += stepZ * TAIL.segment;
  }
}

function placeEyes(mesh, openness) {
  for (let index = 0; index < SIDES.length; index += 1) {
    scratch.position.set(SIDES[index] * EYE.spread, EYE.y, EYE.z);
    scratch.rotation.set(0, 0, 0);
    scratch.scale.set(EYE.width, EYE.height * openness, EYE.depth);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }
}

/**
 * Кот, гуляющий по кругу вокруг алтаря.
 *
 * Сид меняет окрас, цвет глаз, длину хвоста, темп шага и точку старта на круге, но не
 * саму походку: её задают радиус круга и длина шага.
 */
export function createCat({ rng, radius = WALK.radius }) {
  const walk = planWalk(rng, radius);
  const legs = planLegs(walk);
  const tailCount = rng.int(...TAIL.count);
  const materials = createMaterials(rng);

  const box = new THREE.BoxGeometry(1, 1, 1);
  const trunk = buildTrunk(box, materials.fur);
  const ears = buildEars(materials.fur);

  const limbs = new THREE.InstancedMesh(box, materials.fur, TAIL_SLOT + tailCount);
  limbs.castShadow = true;
  limbs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Лапы и хвост переставляются каждый кадр, а сфера отсечения считается один раз.
  limbs.frustumCulled = false;

  const eyes = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(1),
    materials.eye,
    SIDES.length,
  );
  eyes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const body = new THREE.Group();
  body.add(trunk, limbs, ears, eyes);
  const group = new THREE.Group();
  group.add(body);

  // Кадру достаются только числа: ни новых векторов, ни пересборки геометрии.
  function update(elapsed) {
    const angle = walk.start + elapsed * walk.spin;
    const gait = ((angle - walk.start) * walk.steps) / TAU;

    group.position.set(Math.cos(angle) * walk.radius, 0, Math.sin(angle) * walk.radius);
    group.rotation.y = -angle;

    const bob = Math.sin(gait * TAU * WALK.bobRate) * WALK.bob;
    body.position.y = bob;
    body.rotation.z = Math.sin(gait * TAU) * WALK.roll;

    const footBase = PAW.height - LEG.hip - bob;
    for (let index = 0; index < legs.length; index += 1) {
      placeLeg(limbs, index, legs[index], gait, footBase);
    }
    placeTail(limbs, tailCount, elapsed);
    limbs.instanceMatrix.needsUpdate = true;

    const since = elapsed % BLINK.period;
    const shut = since < BLINK.close ? Math.sin((since / BLINK.close) * Math.PI) : 0;
    placeEyes(eyes, 1 - shut * (1 - BLINK.narrow));
    eyes.instanceMatrix.needsUpdate = true;

    const breath = HALF + HALF * Math.sin((elapsed / BEAT.seconds) * TAU);
    materials.eye.emissiveIntensity = GLOW.base + GLOW.swing * breath;
  }

  update(0);

  return { group, update };
}
