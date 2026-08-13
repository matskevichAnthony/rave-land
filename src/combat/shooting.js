import * as THREE from 'three';
import { COMBAT } from '../config.js';

/**
 * Решение о попадании: чистая функция над данными.
 *
 * Ни камеры, ни DOM, ни ввода: на входе точка вылета, направление, ствол и генератор
 * случайных чисел бойца. Поэтому один и тот же выстрел решается одинаково и у игрока, и у
 * бота, и повторяется при том же зерне.
 */

const SPREAD_UNIT = THREE.MathUtils.degToRad(COMBAT.spreadDegrees);

// Вектора и ответ заводятся один раз: стреляет вся арена сразу, и выделять их на выстрел
// значит кормить мусорщик ровно в момент, когда кадр и так занят. Ответ живёт до следующего
// выстрела, поэтому читать его надо сразу, а не откладывать.
const scratch = {
  side: new THREE.Vector3(),
  up: new THREE.Vector3(),
};
const shot = {
  direction: new THREE.Vector3(),
  point: new THREE.Vector3(),
  distance: 0,
  target: null,
  zone: null,
};

/**
 * Угол увода ствола от прицельной линии.
 *
 * Базу даёт `accuracy` из weapon.dat: у АК она 0.5, то есть вдвое хуже пистолетной, и это
 * различие приходит из данных, а не из наших предпочтений. Дальше только множители за
 * состояние: на ходу мажут вдвое сильнее, а в первые полсекунды после появления цели ствол
 * ещё не пойман.
 */
function spreadFor(fighter) {
  const moving = fighter.speed > COMBAT.movingThreshold ? COMBAT.movingSpreadFactor : 1;
  const fresh = fighter.aimedFor < COMBAT.freshTargetSeconds ? COMBAT.freshTargetSpreadFactor : 1;
  const hand = fighter.isPlayer ? COMBAT.playerSpreadFactor : 1;
  return (SPREAD_UNIT / fighter.weapon.accuracy) * moving * fresh * hand;
}

/** Симметричный разброс: два независимых случайных числа дают нормальное облако вокруг оси. */
function scatter(direction, spread, rng) {
  const horizontal = (rng() + rng() - 1) * spread;
  const vertical = (rng() + rng() - 1) * spread * COMBAT.verticalSpreadShare;
  scratch.side.set(-direction.z, 0, direction.x);
  if (scratch.side.lengthSq() < 1e-6) scratch.side.set(1, 0, 0);
  scratch.side.normalize();
  scratch.up.crossVectors(scratch.side, direction).normalize();
  return direction
    .addScaledVector(scratch.side, Math.tan(horizontal))
    .addScaledVector(scratch.up, Math.tan(vertical))
    .normalize();
}

/** Зона по высоте точки попадания над стопами: отдельных коллайдеров на части тела нет. */
function zoneAt(pointY, feetY) {
  const share = (pointY - feetY) / COMBAT.bodyHeight;
  return COMBAT.zones.find((zone) => share > zone.above);
}

/**
 * Куда пришла пуля: в бойца, в мир или в пустоту на пределе дальности.
 *
 * Порядок важен: сначала считается ближайший боец, потом преграда, и побеждает то, что
 * ближе. Так пуля перестаёт проходить сквозь дом и перестаёт пролетать сквозь того, кто
 * стоит перед домом.
 */
export function resolveShot({ ray, shooter, origin, aim, targets, rng }) {
  const weapon = shooter.weapon;
  const direction = scatter(shot.direction.copy(aim).normalize(), spreadFor(shooter), rng);
  const wall = ray.world(origin, direction, weapon.range);
  const found = ray.fighter(origin, direction, wall ?? weapon.range, targets);
  shot.distance = found ? found.distance : (wall ?? weapon.range);
  shot.point.copy(origin).addScaledVector(direction, shot.distance);
  shot.target = found?.fighter ?? null;
  shot.zone = found ? zoneAt(shot.point.y, found.fighter.y) : null;
  return shot;
}
