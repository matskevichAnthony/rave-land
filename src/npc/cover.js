import * as THREE from 'three';
import { BOT } from '../config.js';

/**
 * Укрытия выводятся из мира, а не размечаются руками.
 *
 * В мире уже стоят мешки с песком, барьеры, ящики и бочки, и все они одинаково годятся,
 * чтобы за них сесть. Поэтому укрытие это любой объект подходящего роста и обхвата: список
 * строится один раз по габаритам сцены, и добавленный в редакторе ящик становится укрытием
 * сам, без второй таблицы рядом с миром.
 */

const MIN_HEIGHT = 0.4;
const MAX_HEIGHT = 2.4;
const MAX_FOOTPRINT = 4;
const STAND_BACK = 0.7;
const MIN_ENEMY_DISTANCE = 5;
const SAME_SPOT = 2.5;

export function buildCoverPoints(objects) {
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  const points = [];
  for (const object of objects) {
    box.setFromObject(object);
    if (box.isEmpty()) continue;
    box.getSize(size);
    box.getCenter(center);
    const footprint = Math.max(size.x, size.z) / 2;
    if (size.y < MIN_HEIGHT || size.y > MAX_HEIGHT || footprint > MAX_FOOTPRINT) continue;
    points.push({ x: center.x, z: center.z, radius: footprint });
  }
  return points;
}

/**
 * Точка за ближайшим укрытием, с противоположной от врага стороны.
 *
 * Укрытие вплотную к врагу не укрытие, поэтому слишком близкие к нему отбрасываются: иначе
 * бот бежит прятаться прямо тому под ноги.
 *
 * `avoid` это укрытие, за которым боец уже отсиделся. Без него выбор детерминирован, тот же
 * ящик выигрывает снова и снова, и «пересидеть и сменить позицию» превращается в стояние
 * столбом на всю перестрелку.
 */
export function bestCover(points, from, enemy, avoid = null) {
  let best = null;
  let bestScore = Infinity;
  for (const point of points) {
    const reach = Math.hypot(point.x - from.x, point.z - from.z);
    if (reach > BOT.coverRadius || reach >= bestScore) continue;
    const awayX = point.x - enemy.x;
    const awayZ = point.z - enemy.z;
    const toEnemy = Math.hypot(awayX, awayZ);
    if (toEnemy < MIN_ENEMY_DISTANCE) continue;
    const back = point.radius + STAND_BACK;
    const spot = { x: point.x + (awayX / toEnemy) * back, z: point.z + (awayZ / toEnemy) * back };
    if (avoid && Math.hypot(spot.x - avoid.x, spot.z - avoid.z) < SAME_SPOT) continue;
    bestScore = reach;
    best = spot;
  }
  return best;
}
