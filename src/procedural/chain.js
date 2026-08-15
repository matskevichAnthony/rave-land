/** Раскладка цепи по прямой: планировщик отдаёт данные, геометрию собирает вызывающий. */

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_STEP = 0.3;

/**
 * Добавляет в `links` звенья от точки до точки вдоль произвольного направления.
 *
 * Каждое второе звено помечено `flip`: цепь из одинаково лежащих колец читается плоской
 * лентой, а разворот на четверть оборота делает её цепью. Сам разворот применяет тот, кто
 * строит меши: планировщик не знает, чем звено нарисуют.
 */
export function planChain(links, from, to, step = DEFAULT_STEP) {
  const direction = to.clone().sub(from);
  const twist = new THREE.Quaternion().setFromUnitVectors(UP, direction.clone().normalize());
  const count = Math.max(2, Math.round(direction.length() / step));
  for (let index = 0; index < count; index += 1) {
    links.push({
      point: from.clone().addScaledVector(direction, index / count),
      twist,
      flip: index % 2,
    });
  }
  return links;
}
