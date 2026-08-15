/**
 * Единичные заготовки форм: метры приходят масштабом инстанса, а не размером буфера.
 *
 * Полоса стали сделана открытым цилиндром, а не тором: у полосы нет толщины трубы, и
 * второй контур стоил бы треугольников, ничего не добавив в кадр.
 */

import * as THREE from 'three';

const QUARTER_TURN = Math.PI / 2;

const SEGMENTS = {
  band: 12,
  ring: 32,
  arch: 20,
  disc: 20,
  tube: 4,
  link: 8,
  hook: 10,
};

const CHAIN_LINK = { radius: 0.13, tube: 0.035 };
const HOOK = { radius: 0.22, tube: 0.05, arc: Math.PI * 1.45 };

/** Открытая полоса вдоль Y. Разные радиусы дают конус: так делают столб света. */
export function openBandY({ top = 1, bottom = 1, segments = SEGMENTS.band } = {}) {
  return new THREE.CylinderGeometry(top, bottom, 1, segments, 1, true);
}

/** Кольцо в плоскости XY: обод окна, хомут, обруч. */
export function ringZ({ segments = SEGMENTS.ring } = {}) {
  return new THREE.CylinderGeometry(1, 1, 1, segments, 1, true).rotateX(QUARTER_TURN);
}

/** Полуарка в плоскости XY: половина кольца, стоящая на своих концах. */
export function archZ({ segments = SEGMENTS.arch } = {}) {
  return new THREE.CylinderGeometry(1, 1, 1, segments, 1, true, QUARTER_TURN, Math.PI)
    .rotateX(QUARTER_TURN);
}

/** Диск, лежащий в плоскости XZ лицом вверх. */
export function flatDisc({ segments = SEGMENTS.disc } = {}) {
  return new THREE.CircleGeometry(1, segments).rotateX(-QUARTER_TURN);
}

/** Звено цепи. Раскладывает и разворачивает их `planChain`, форма об этом не знает. */
export function chainLink({
  radius = CHAIN_LINK.radius,
  tube = CHAIN_LINK.tube,
  segments = SEGMENTS.tube,
  sides = SEGMENTS.link,
} = {}) {
  return new THREE.TorusGeometry(radius, tube, segments, sides);
}

/** Крюк: незамкнутая дуга той же трубы, что и звено. */
export function hook({
  radius = HOOK.radius,
  tube = HOOK.tube,
  arc = HOOK.arc,
  segments = SEGMENTS.tube,
  sides = SEGMENTS.hook,
} = {}) {
  return new THREE.TorusGeometry(radius, tube, segments, sides, arc);
}
