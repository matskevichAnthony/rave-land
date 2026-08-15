/**
 * Материалы полудня: песок, известняк и гранит.
 *
 * Карты рисуются на canvas по сиду, файлов у сцены нет. Одна карта зерна идёт и
 * шероховатостью, и рельефом: под отвесным солнцем важна не раскраска камня, а то, что
 * поверхность перестаёт быть гладкой и ловит свет неровно.
 *
 * Известняк выбелен почти до бумаги намеренно. Тёмного в кадре ровно два сорта: гранит
 * богов и собственная тень камня, и оба работают силуэтом, а не цветом.
 */

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createSurfaceGrunge } from '../procedural/grunge.js';

const STONE_TILE = 3.2;
/** Шаг песчаной ряби в метрах: развёртку по нему считает тот, кто строит меш. */
export const SAND_TILE = 6;

const STONE = { bump: 0.05, roughness: 0.93 };
const GRANITE = { bump: 0.035, roughness: 0.52, metalness: 0.06 };
const SAND = { roughness: 1, bump: 0.09 };

/**
 * Развёртка коробки в метрах.
 *
 * У `BoxGeometry` каждая грань размечена от нуля до единицы, поэтому одна и та же
 * текстура растянулась бы по башне пилона и сжалась бы на ступени. Здесь развёртка
 * домножается на размеры коробки, и зерно камня везде одного масштаба.
 */
function tileBox(geometry, width, height, depth, tile = STONE_TILE) {
  const uv = geometry.attributes.uv;
  const spans = [
    [depth, height], [depth, height],
    [width, depth], [width, depth],
    [width, height], [width, height],
  ];
  for (let face = 0; face < spans.length; face += 1) {
    const [spanU, spanV] = spans[face];
    for (let corner = 0; corner < 4; corner += 1) {
      const index = face * 4 + corner;
      uv.setXY(index, uv.getX(index) * spanU / tile, uv.getY(index) * spanV / tile);
    }
  }
  return geometry;
}

/** Развёртка тел вращения: сколько раз зерно ложится по кругу и по высоте. */
export function scaleUv(geometry, spanU, spanV, tile = STONE_TILE) {
  const uv = geometry.attributes.uv;
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * spanU / tile, uv.getY(index) * spanV / tile);
  }
  return geometry;
}

/** Коробка с готовой развёрткой: метры приходят сюда, а не масштабом узла. */
export function stoneBox(width, height, depth) {
  return tileBox(new THREE.BoxGeometry(width, height, depth), width, height, depth);
}

/**
 * Блок с завалом стен: низ шире верха.
 *
 * Пилон, мастаба и стела держатся именно на этом наклоне, коробка с отвесными гранями
 * читается новостройкой. Четырёхгранный цилиндр развёрнут на восьмую оборота, чтобы
 * грани встали по осям, и отмасштабирован до нужного плана.
 */
export function taperedBox(width, height, depth, taper) {
  const half = 1 / Math.SQRT2;
  const geometry = new THREE.CylinderGeometry(half * taper, half, 1, 4, 1)
    .rotateY(Math.PI / 4)
    .scale(width, height, depth);
  return scaleUv(geometry, width * 4, height);
}

export function createStoneMaps(rng) {
  const grain = createSurfaceGrunge({ random: rng, size: 256, spots: 90, streaks: 30 });
  grain.repeat.set(1, 1);
  const ripple = createSurfaceGrunge({
    random: rng,
    size: 256,
    spots: 30,
    spotRadius: [0.2, 0.6],
    streaks: 24,
    grain: 150,
    range: [0.35, 1],
  });
  ripple.repeat.set(1, 1);
  return { grain, ripple };
}

export function createMaterials(maps) {
  const limestone = new THREE.MeshStandardMaterial({
    color: PALETTE.limestone,
    roughness: STONE.roughness,
    metalness: 0,
    roughnessMap: maps.grain,
    bumpMap: maps.grain,
    bumpScale: STONE.bump,
  });

  const worn = new THREE.MeshStandardMaterial({
    color: PALETTE.limestoneWorn,
    roughness: STONE.roughness,
    metalness: 0,
    roughnessMap: maps.grain,
    bumpMap: maps.grain,
    bumpScale: STONE.bump * 1.6,
  });

  const granite = new THREE.MeshStandardMaterial({
    color: PALETTE.granite,
    roughness: GRANITE.roughness,
    metalness: GRANITE.metalness,
    roughnessMap: maps.grain,
    bumpMap: maps.grain,
    bumpScale: GRANITE.bump,
  });

  const sand = new THREE.MeshStandardMaterial({
    color: PALETTE.sand,
    roughness: SAND.roughness,
    metalness: 0,
    roughnessMap: maps.ripple,
    bumpMap: maps.ripple,
    bumpScale: SAND.bump,
  });

  const drift = new THREE.MeshStandardMaterial({
    color: PALETTE.sandDeep,
    roughness: SAND.roughness,
    metalness: 0,
    bumpMap: maps.ripple,
    bumpScale: SAND.bump,
  });

  return { limestone, worn, granite, sand, drift };
}
