import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { NAVE } from './nave.js';
import { buildInstanced } from '../procedural/instancing.js';

/**
 * Кроваво-красные розы у алтаря.
 *
 * Цветок собран из ярусов лепестков, а не из модели: зал целиком процедурный, и лишний
 * ассет ради семи цветков ему не нужен. Все лепестки всех роз идут одним инстансом, все
 * стебли вторым, поэтому букет стоит сцене двух сущностей, а не четырнадцати.
 *
 * Лепесток светится сам: в этом зале красное без эмиссии читается чёрным пятном, а роза
 * обязана быть узнаваема с точки съёмки афиши.
 */

const BOUQUET = {
  count: 13,
  radius: [NAVE.altarRadius + 0.3, NAVE.altarRadius + 2.2],
  onAltar: 3,
  altarRadius: [1.4, NAVE.altarRadius - 1.2],
  // Дуга отсчитывается от оси камеры: розы должны лежать перед алтарём, а не за ним.
  frontArc: [-0.3, 0.3],
};

const STEM = {
  radius: 0.022,
  length: [0.4, 0.95],
  lean: 0.35,
  sides: 4,
};

// Ярус это кольцо лепестков: `size` длина лепестка, `offset` насколько он отходит от оси.
// Отход обязан быть много меньше длины, иначе венчик рассыпается в горсть лопухов.
const BLOOM = {
  tiers: [
    { petals: 7, size: 0.15, offset: 0.05, lift: 0, open: 1.3 },
    { petals: 5, size: 0.12, offset: 0.032, lift: 0.035, open: 0.85 },
    { petals: 3, size: 0.085, offset: 0.016, lift: 0.06, open: 0.35 },
  ],
  petalArc: Math.PI * 0.85,
  petalSides: 5,
  emissive: 0.75,
};

const TAU = Math.PI * 2;

function petalGeometry() {
  const geometry = new THREE.SphereGeometry(
    1,
    BLOOM.petalSides,
    3,
    0,
    BLOOM.petalArc,
    0,
    Math.PI * 0.55,
  );
  geometry.translate(0, -0.35, 0);
  return geometry;
}

/** Одна роза: где стоит, куда наклонена и насколько крупная. */
function planRose(rng, onAltar) {
  const turn = TAU * rng.range(...BOUQUET.frontArc);
  const radius = onAltar
    ? rng.range(...BOUQUET.altarRadius)
    : rng.range(...BOUQUET.radius);
  return {
    x: Math.sin(turn) * radius,
    z: Math.cos(turn) * radius,
    ground: onAltar ? NAVE.altarHeight : 0,
    length: rng.range(...STEM.length),
    lean: new THREE.Euler(rng.range(-STEM.lean, STEM.lean), rng() * TAU, rng.range(-STEM.lean, STEM.lean)),
    scale: rng.range(0.8, 1.35),
  };
}

function petalPlans(roses, rng) {
  const plans = [];
  for (const rose of roses) {
    for (const tier of BLOOM.tiers) {
      const phase = rng() * TAU;
      for (let index = 0; index < tier.petals; index += 1) {
        plans.push({ rose, tier, angle: phase + (TAU * index) / tier.petals });
      }
    }
  }
  return plans;
}

/** Букет: стебли и лепестки двумя инстансами, головки собраны ярусами вокруг оси стебля. */
export function createRoses({ rng }) {
  const roses = Array.from({ length: BOUQUET.count }, (unused, index) => planRose(rng, index < BOUQUET.onAltar));

  const stemMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.iron,
    metalness: 0.3,
    roughness: 0.9,
  });
  const petalMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.blood,
    emissive: PALETTE.blood,
    emissiveIntensity: BLOOM.emissive,
    metalness: 0.15,
    roughness: 0.65,
    side: THREE.DoubleSide,
  });

  const stems = buildInstanced(
    new THREE.CylinderGeometry(STEM.radius, STEM.radius * 1.6, 1, STEM.sides),
    stemMaterial,
    roses.length,
    (stem, index) => {
      const rose = roses[index];
      stem.position.set(rose.x, rose.ground + rose.length / 2, rose.z);
      stem.rotation.copy(rose.lean);
      stem.scale.set(1, rose.length, 1);
    },
  );

  const petals = petalPlans(roses, rng);
  const heads = buildInstanced(
    petalGeometry(),
    petalMaterial,
    petals.length,
    (petal, index) => {
      const { rose, tier, angle } = petals[index];
      petal.position.set(
        rose.x + Math.cos(angle) * tier.offset * rose.scale,
        rose.ground + rose.length + tier.lift * rose.scale,
        rose.z + Math.sin(angle) * tier.offset * rose.scale,
      );
      petal.rotation.set(tier.open, -angle, 0);
      petal.scale.setScalar(tier.size * rose.scale);
    },
  );

  const group = new THREE.Group();
  group.add(stems, heads);
  return { object: group };
}
