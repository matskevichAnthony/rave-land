import * as THREE from 'three';
import { COMBAT } from '../config.js';

/**
 * Лучи боя: мир решается физикой, бойцы считаются аналитически.
 *
 * Дома, рельеф и мешки с песком стоят в Rapier коллайдерами, поэтому расстояние до
 * препятствия честно даёт `castRay`. Бойцам своих коллайдеров не заводится вовсе: капсулы
 * живых NPC начали бы толкаться между собой и толкать игрока, а синхронизировать их каждый
 * кадр стоит дороже, чем пересечь луч с десятком отрезков. Отрезок «стопы-макушка» и радиус
 * тела дают ту же капсулу без единого объекта в физике.
 */

const scratch = {
  toTarget: new THREE.Vector3(),
  axis: new THREE.Vector3(),
  cross: new THREE.Vector3(),
};

/**
 * Расстояние до ближайшей точки, где луч подходит к отрезку тела ближе радиуса.
 *
 * Классическое сближение двух отрезков: ищем параметры, при которых расстояние между лучом
 * и осью капсулы минимально, и меряем это расстояние. Возвращает null, если мимо.
 */
function capsuleDistance(origin, direction, feet, height, radius, range) {
  const axis = scratch.axis.set(0, height, 0);
  const toTarget = scratch.toTarget.copy(feet).sub(origin);
  const dirDotAxis = direction.dot(axis);
  const dirDotTo = direction.dot(toTarget);
  const axisDotTo = axis.dot(toTarget);
  const axisLengthSq = axis.lengthSq();
  const denominator = axisLengthSq - dirDotAxis * dirDotAxis;
  // Луч почти вдоль оси тела: сближение вырождено, хватит проекции на сам луч.
  const alongAxis = denominator > 1e-6
    ? THREE.MathUtils.clamp((dirDotAxis * dirDotTo - axisDotTo) / denominator, 0, 1)
    : THREE.MathUtils.clamp(axisDotTo / axisLengthSq, 0, 1);
  const alongRay = dirDotTo + alongAxis * dirDotAxis;
  if (alongRay < 0 || alongRay > range) return null;
  const gap = scratch.cross
    .copy(direction).multiplyScalar(alongRay)
    .sub(toTarget)
    .addScaledVector(axis, -alongAxis)
    .length();
  if (gap > radius) return null;
  // Поверхность капсулы ближе её оси: вычитаем ушедшее вглубь, иначе попадания «залипают»
  // на середине тела и зона считается по неверной высоте.
  return Math.max(0, alongRay - Math.sqrt(Math.max(0, radius * radius - gap * gap)));
}

export function createRay({ RAPIER, physicsWorld, ignoreCollider }) {
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });

  /**
   * Дистанция до преграды мира или null, если луч дошёл до конца свободно.
   *
   * Капсула игрока исключается всегда: она стоит в физике ради движения, а попадания по
   * игроку решаются тем же аналитическим тестом, что и по остальным. Иначе своя же капсула
   * ловила бы чужие пули как стена.
   */
  function world(origin, direction, range) {
    ray.origin.x = origin.x;
    ray.origin.y = origin.y;
    ray.origin.z = origin.z;
    ray.dir.x = direction.x;
    ray.dir.y = direction.y;
    ray.dir.z = direction.z;
    const hit = physicsWorld.castRay(ray, range, true, undefined, undefined, ignoreCollider);
    return hit ? hit.timeOfImpact : null;
  }

  /** Ближайший боец на луче из переданных, вместе с дистанцией до него. */
  function fighter(origin, direction, range, candidates) {
    let best = null;
    let bestDistance = range;
    for (const candidate of candidates) {
      const distance = capsuleDistance(
        origin, direction, candidate, COMBAT.bodyHeight, COMBAT.bodyRadius, bestDistance);
      if (distance === null) continue;
      bestDistance = distance;
      best = candidate;
    }
    return best ? { fighter: best, distance: bestDistance } : null;
  }

  return { world, fighter };
}
