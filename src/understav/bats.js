/**
 * Стая летучих мышей под сводом нефа.
 *
 * Вся стая это один вызов отрисовки: тело и крылья лежат одной заготовкой, положение
 * каждой мыши считается на процессоре в её матрицу, а взмах живёт в вершинном шейдере,
 * поэтому геометрия в кадре не пересобирается.
 *
 * Летают они выше коробки типографики и не заходят за торцевую стену: буквы им не по
 * пути, а за розой начинается улица.
 */

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { NAVE, TYPE_BOX } from './nave.js';

const SPAN = [0.7, 1.3];

/**
 * Стая идёт двумя ярусами: основная часть под сводом, немного низом мимо углей.
 *
 * Ярус задаёт коридор, а не отдельную траекторию: круги внутри яруса похожи, поэтому стая
 * читается стаей. Разброс скоростей узкий намеренно, иначе движение выглядит хаосом.
 */
const TIERS = [
  {
    count: [7, 10],
    centerX: [-3, 3],
    centerY: [12.5, 18],
    centerZ: [-13, -5],
    radiusX: [5, 10],
    radiusZ: [3, 6.5],
    speed: [0.2, 0.34],
    bob: [0.25, 0.7],
    bobRate: [0.5, 1.1],
  },
  {
    count: [3, 5],
    centerX: [-2, 2],
    centerY: [1.9, 3.8],
    centerZ: [-4.5, -2.5],
    radiusX: [8, 12],
    radiusZ: [5.5, 8],
    speed: [0.24, 0.36],
    bob: [0.2, 0.5],
    bobRate: [0.6, 1.2],
  },
];

// Взмах намеренно идёт мимо бита: стая, машущая в такт, читается гирляндой, а не живностью.
const FLAP = { rate: [7, 12], lift: 0.55, fold: 0.22 };

const BANK = 0.55;
const PITCH_GAIN = 0.5;
const WALL_GAP = 1.5;

// Половина крыла в местных единицах: заготовка строится размахом в единицу от оси тела.
const WING = [
  [[0.05, 0, 0.18], [0.05, 0, -0.2], [0.55, 0.02, 0.02]],
  [[0.05, 0, -0.2], [0.55, 0.02, 0.02], [0.5, 0.01, -0.38]],
  [[0.55, 0.02, 0.02], [1, 0.05, -0.06], [0.5, 0.01, -0.38]],
];

const BODY = { width: 0.13, height: 0.13, length: 0.52 };

const scratch = new THREE.Object3D();

function pushTriangle(target, triangle, mirror) {
  for (const [x, y, z] of triangle) target.push(mirror ? -x : x, y, z);
}

/** Заготовка мыши: два крыла и тело, крылья помечены атрибутом, чтобы шейдер гнул только их. */
function createBatGeometry() {
  const positions = [];
  const wingFlags = [];
  for (const mirror of [false, true]) {
    for (const triangle of WING) {
      pushTriangle(positions, triangle, mirror);
      wingFlags.push(1, 1, 1);
    }
  }

  const body = new THREE.BoxGeometry(BODY.width, BODY.height, BODY.length).toNonIndexed();
  const bodyPositions = body.getAttribute('position').array;
  positions.push(...bodyPositions);
  for (let index = 0; index < bodyPositions.length / 3; index += 1) wingFlags.push(0);
  body.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aWing', new THREE.Float32BufferAttribute(wingFlags, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function createBatMaterial(time) {
  const material = new THREE.MeshStandardMaterial({
    color: PALETTE.iron,
    roughness: 0.94,
    metalness: 0.05,
    side: THREE.DoubleSide,
    flatShading: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float aWing;
        attribute vec2 aFlap;
        uniform float uTime;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float flap = sin(uTime * aFlap.x + aFlap.y);
        float reach = abs(transformed.x);
        transformed.y += aWing * flap * reach * reach * ${FLAP.lift.toFixed(3)};
        transformed.z -= aWing * abs(flap) * reach * ${FLAP.fold.toFixed(3)};`,
      );
  };
  return material;
}

/**
 * Нижний ярус проходит на высоте лайнапа, поэтому круг обязан обходить коробку с буквами
 * стороной: в её глубину мышь заходит только там, где по ширине она уже далеко от текста.
 */
function keepsClearOfType(bat) {
  if (bat.centerY - bat.bob > TYPE_BOX.y + TYPE_BOX.height / 2) return true;
  const nearZ = Math.min(
    Math.abs(bat.centerZ + bat.radiusZ - TYPE_BOX.z),
    Math.abs(bat.centerZ - bat.radiusZ - TYPE_BOX.z),
  );
  return nearZ > TYPE_BOX.depth / 2 + WALL_GAP;
}

function planBat(rng, tier, turn) {
  const centerZ = rng.range(...tier.centerZ);
  const bat = {
    centerX: rng.range(...tier.centerX),
    centerY: rng.range(...tier.centerY),
    centerZ,
    radiusX: rng.range(...tier.radiusX),
    radiusZ: Math.min(rng.range(...tier.radiusZ), centerZ - NAVE.endZ - WALL_GAP),
    speed: rng.range(...tier.speed),
    turn,
    phase: rng.range(0, Math.PI * 2),
    bob: rng.range(...tier.bob),
    bobRate: rng.range(...tier.bobRate),
    bobPhase: rng.range(0, Math.PI * 2),
    span: rng.range(...SPAN),
  };
  if (keepsClearOfType(bat)) return bat;
  bat.radiusZ = TYPE_BOX.depth / 2 + WALL_GAP + Math.abs(bat.centerZ - TYPE_BOX.z);
  return bat;
}

function planFlock(rng) {
  const flock = [];
  for (const tier of TIERS) {
    // Ярус летит в одну сторону: встречные круги на одной высоте читаются как беспорядок.
    const turn = rng.sign();
    const count = rng.int(...tier.count);
    for (let index = 0; index < count; index += 1) flock.push(planBat(rng, tier, turn));
  }
  return flock;
}

export function createBats({ rng }) {
  const flock = planFlock(rng);
  const count = flock.length;

  const time = { value: 0 };
  const geometry = createBatGeometry();
  const mesh = new THREE.InstancedMesh(geometry, createBatMaterial(time), count);

  const flap = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    flap[index * 2] = rng.range(...FLAP.rate);
    flap[index * 2 + 1] = rng.range(0, Math.PI * 2);
  }
  geometry.setAttribute('aFlap', new THREE.InstancedBufferAttribute(flap, 2));

  // Матрицы переписываются каждый кадр, поэтому считать по ним отсечение бессмысленно:
  // сфера устареет к следующему кадру, а стая всё равно висит в середине зала.
  mesh.frustumCulled = false;
  mesh.castShadow = false;

  const group = new THREE.Group();
  group.add(mesh);

  function place(bat, index, elapsed) {
    const angle = bat.phase + elapsed * bat.speed * bat.turn;
    const bob = Math.sin(elapsed * bat.bobRate + bat.bobPhase);
    scratch.position.set(
      bat.centerX + Math.sin(angle) * bat.radiusX,
      bat.centerY + bob * bat.bob,
      bat.centerZ + Math.cos(angle) * bat.radiusZ,
    );
    const stepX = Math.cos(angle) * bat.radiusX * bat.turn;
    const stepZ = -Math.sin(angle) * bat.radiusZ * bat.turn;
    const climb = Math.cos(elapsed * bat.bobRate + bat.bobPhase) * bat.bob * bat.bobRate;
    scratch.rotation.set(
      -climb * PITCH_GAIN,
      Math.atan2(stepX, stepZ),
      -Math.sin(angle) * bat.turn * BANK,
    );
    scratch.scale.setScalar(bat.span);
    scratch.updateMatrix();
    mesh.setMatrixAt(index, scratch.matrix);
  }

  function update(elapsed) {
    time.value = elapsed;
    for (let index = 0; index < flock.length; index += 1) place(flock[index], index, elapsed);
    mesh.instanceMatrix.needsUpdate = true;
  }

  update(0);

  return { group, update };
}
