/**
 * Вихрь: спираль из плит, осколков и фигурок, уходящая в небо.
 *
 * Это главный аттракцион кадра и единственное быстрое движение в сцене. Вихрь выдирает
 * куски из песка: у самой земли обломки крупные и медленные, они появляются прямо из
 * воронки, выше идут мельче и быстрее, у вершины истончаются и пропадают в небе.
 *
 * Вся спираль это три `InstancedMesh`, юбка пыли, полог и одна система точек: сколько бы
 * предметов в ней ни летело, кадру она стоит семь вызовов отрисовки. Матрицы считаются на
 * месте, потому что триста черновиков в кадре дешевле, чем шейдер, который придётся
 * поддерживать вместе с сортировкой прозрачности.
 */

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { STORM, VORTEX, surgeAt, stormPhase } from './hall.js';
import { createSparks } from '../procedural/sparks.js';
import { createBlobTexture } from '../procedural/canvas-texture.js';
import { openBandY } from '../procedural/shapes.js';
import { between } from '../procedural/random.js';

const TAU = Math.PI * 2;

const FLOW = { base: 0.55, gust: 0.8, maxStep: 0.1 };
/** Закрутка меряется оборотами на всю высоту: у песка круче, к вершине разматывается. */
const TWIST = 3.4;
const ARMS = 3;
const ARM_SPREAD = 0.34;
const FUNNEL = { flare: 1.5, breathe: 0.22, lane: [0.72, 1.16] };
const FADE = { born: 0.05, spent: 0.82, shrink: 0.62 };

/**
 * Три потока разной крупности.
 *
 * Крупное идёт медленно и низко, мелкое быстро и высоко: спираль читается только тогда,
 * когда у неё есть шаг. Гранитные фигурки самые тёмные в кадре, поэтому их мало и они
 * мелкие: десяток чёрных пятен в небе воспринимается мусором, а не богами в полёте.
 */
const SWARM = {
  slabs: { count: 92, size: [0.7, 2.1], speed: [0.02, 0.05], box: [1, 0.22, 0.62] },
  shards: { count: 180, size: [0.24, 0.8], speed: [0.035, 0.09], box: [1, 0.5, 0.8] },
  figures: { count: 14, size: [0.8, 1.7], speed: [0.016, 0.036] },
};

/**
 * Юбка: пыль, поднятая у самой земли.
 *
 * Она полупрозрачная и мелкая намеренно. Плотные тела на этом месте читаются то кладкой
 * яиц, то блинами: у песчаного облака нет силуэта, есть только плотность.
 */
const SKIRT = {
  count: 38,
  radius: [0.9, 2],
  height: [0.5, 3.6],
  size: [1.1, 2.6],
  squash: 0.38,
  spin: 0.9,
  opacity: 0.26,
};

const VEIL = { opacity: 0.32, scroll: 0.05, blobs: 30, repeat: [4, 2] };
const CRATER = { segments: 40 };
const DUST = { count: 220, size: 22, sources: 10, top: 0.85, jitter: 1.4 };

const draft = new THREE.Object3D();

/**
 * Радиус воронки на высоте `share`.
 *
 * Степень больше единицы даёт узкое горло у песка и раскрытый раструб вверху: это та
 * форма, по которой вихрь читается вихрем, а не столбом.
 */
function funnelRadius(share, surge) {
  const flare = VORTEX.baseRadius
    + (VORTEX.topRadius - VORTEX.baseRadius) * Math.pow(share, FUNNEL.flare);
  return flare * (1 - FUNNEL.breathe + FUNNEL.breathe * surge);
}

function smoothstep(edge0, edge1, value) {
  const share = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return share * share * (3 - 2 * share);
}

/**
 * Раскладка потока по рукавам.
 *
 * Ровный разброс по кругу даёт облако: обломки на одной высоте стоят под всеми углами
 * сразу, и спирали не видно. Начальный угол взят по трём рукавам, и закрутка по высоте
 * вытягивает их в винт, который читается и на неподвижном кадре.
 */
function planPieces(rng, plan) {
  return Array.from({ length: plan.count }, (unused, index) => ({
    offset: rng(),
    speed: between(rng, ...plan.speed),
    size: between(rng, ...plan.size),
    lane: between(rng, ...FUNNEL.lane),
    turn: (index % ARMS) * (TAU / ARMS) + between(rng, -ARM_SPREAD, ARM_SPREAD),
    tumble: [between(rng, -1.4, 1.4), between(rng, -1.4, 1.4)],
  }));
}

/** Один поток спирали: своя геометрия, свой темп, общая воронка. */
function createSwarm({ rng, plan, geometry, material }) {
  const pieces = planPieces(rng, plan);
  const mesh = new THREE.InstancedMesh(geometry, material, pieces.length);
  mesh.frustumCulled = false;
  mesh.castShadow = true;

  function update(flow, surge) {
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      const share = (piece.offset + flow * piece.speed) % 1;
      const angle = piece.turn + TWIST * TAU * Math.sqrt(share) + flow * STORM.spin;
      const radius = funnelRadius(share, surge) * piece.lane;
      const alive = smoothstep(0, FADE.born, share) * (1 - smoothstep(FADE.spent, 1, share));
      draft.position.set(
        VORTEX.x + Math.cos(angle) * radius,
        share * VORTEX.height,
        VORTEX.z + Math.sin(angle) * radius,
      );
      draft.rotation.set(
        share * TAU * piece.tumble[0] + piece.turn,
        -angle,
        share * TAU * piece.tumble[1],
      );
      draft.scale.setScalar(piece.size * (1 - FADE.shrink * share) * alive);
      draft.updateMatrix();
      mesh.setMatrixAt(index, draft.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, update };
}

/** Крутится вдвое быстрее спирали и просвечивает: это облако, а не тела. */
function createSkirt(rng, source) {
  const material = source.clone();
  material.transparent = true;
  material.opacity = SKIRT.opacity;
  material.depthWrite = false;
  const puffs = Array.from({ length: SKIRT.count }, () => ({
    turn: rng() * TAU,
    radius: between(rng, ...SKIRT.radius),
    height: between(rng, ...SKIRT.height),
    size: between(rng, ...SKIRT.size),
    speed: between(rng, 0.7, 1.4),
  }));

  const mesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.5, 8, 6),
    material,
    puffs.length,
  );
  mesh.frustumCulled = false;

  function update(flow, surge) {
    for (let index = 0; index < puffs.length; index += 1) {
      const puff = puffs[index];
      const angle = puff.turn + flow * SKIRT.spin * puff.speed;
      const radius = VORTEX.baseRadius * puff.radius * (0.8 + 0.4 * surge);
      draft.position.set(
        VORTEX.x + Math.cos(angle) * radius,
        puff.height * (0.7 + 0.5 * surge),
        VORTEX.z + Math.sin(angle) * radius,
      );
      draft.rotation.set(0, -angle, 0);
      draft.scale.set(puff.size, puff.size * SKIRT.squash, puff.size);
      draft.updateMatrix();
      mesh.setMatrixAt(index, draft.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, update };
}

/** Полог: тело воронки, чтобы между обломками не сквозило пустотой. */
function createVeil(rng) {
  const map = createBlobTexture({
    random: rng,
    size: 256,
    blobs: VEIL.blobs,
    radius: [0.1, 0.4],
    alpha: [0.08, 0.3],
    color: PALETTE.haze,
  });
  map.repeat.set(...VEIL.repeat);

  const material = new THREE.MeshBasicMaterial({
    map,
    color: PALETTE.haze,
    transparent: true,
    opacity: VEIL.opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  const mesh = new THREE.Mesh(
    openBandY({ top: VORTEX.topRadius / VORTEX.baseRadius, bottom: 1, segments: 28 })
      .scale(VORTEX.baseRadius, VORTEX.height, VORTEX.baseRadius),
    material,
  );
  mesh.position.set(VORTEX.x, VORTEX.height / 2, VORTEX.z);
  mesh.renderOrder = 2;

  function update(flow, surge) {
    map.offset.x = -flow * VEIL.scroll;
    material.opacity = VEIL.opacity * (0.6 + 0.6 * surge);
  }

  return { mesh, update };
}

/** Воронка в песке: сорванный слой и вал выброса по краю. */
function createCrater(material) {
  const radius = VORTEX.craterRadius;
  const profile = [
    [0, -0.9], [radius * 0.3, -0.75], [radius * 0.58, -0.28],
    [radius * 0.82, 0.62], [radius, 0.3], [radius * 1.3, 0.02],
  ].map(([r, y]) => new THREE.Vector2(r, y));

  const mesh = new THREE.Mesh(
    new THREE.LatheGeometry(profile, CRATER.segments),
    material,
  );
  mesh.position.set(VORTEX.x, 0, VORTEX.z);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Вихрь целиком.
 *
 * Геометрия фигурок приходит снаружи: это те же боги и сфинксы, что стоят на песке,
 * только мелкие. Вихрь не знает, как они устроены, и не заводит собственных.
 */
export function createVortex({ rng, materials, figures }) {
  const group = new THREE.Group();

  const slabs = createSwarm({
    rng,
    plan: SWARM.slabs,
    geometry: new THREE.BoxGeometry(...SWARM.slabs.box),
    material: materials.limestone,
  });
  const shards = createSwarm({
    rng,
    plan: SWARM.shards,
    geometry: new THREE.BoxGeometry(...SWARM.shards.box),
    material: materials.worn,
  });
  const statues = createSwarm({
    rng,
    plan: SWARM.figures,
    geometry: figures,
    material: materials.granite,
  });

  const skirt = createSkirt(rng, materials.sand);
  const veil = createVeil(rng);
  const crater = createCrater(materials.drift);

  const sources = Array.from({ length: DUST.sources }, (unused, index) => [
    VORTEX.x,
    VORTEX.height * DUST.top * (index / (DUST.sources - 1)),
    VORTEX.z,
  ]);
  const dust = createSparks({
    random: rng,
    sources,
    count: DUST.count,
    size: DUST.size,
    jitter: DUST.jitter,
    rise: [6, 18],
    drift: [3, 11],
    speed: [0.02, 0.08],
    hot: PALETTE.haze,
    cold: PALETTE.sandDeep,
  });
  dust.object.renderOrder = 3;

  group.add(
    crater,
    veil.mesh,
    skirt.mesh,
    slabs.mesh,
    shards.mesh,
    statues.mesh,
    dust.object,
  );

  let flow = 0;
  let last = 0;

  /**
   * Поток накапливается шагами, а не берётся от общего времени.
   *
   * Скорость спирали зависит от силы бури, и если считать положение как время на
   * скорость, то любое изменение силы дёргает всю спираль разом: множитель умножается на
   * уже накопленные секунды. Накопитель шага от этого избавляет.
   */
  function update(elapsed) {
    const surge = surgeAt(stormPhase(elapsed));
    const step = Math.min(FLOW.maxStep, Math.max(0, elapsed - last));
    last = elapsed;
    flow += step * (FLOW.base + FLOW.gust * surge);

    slabs.update(flow, surge);
    shards.update(flow, surge);
    statues.update(flow, surge);
    skirt.update(flow, surge);
    veil.update(flow, surge);
    dust.update(flow, surge);
  }

  return { group, update };
}
