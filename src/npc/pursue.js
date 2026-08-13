import { BOT, PLAYER } from '../config.js';

/**
 * Как боец доходит до точки, которую назначил мозг.
 *
 * Провайдер движения того же вида, что и мирный `wander.js`: отдаёт позицию, разворот и
 * скорость, а ставит персонажа на рельеф вызывающий. Навмеша нет и не будет: карта
 * маленькая и почти открытая, поэтому идём по прямой, а упершись в дом, сдвигаемся вбок.
 *
 * Разворот и направление шага считаются раздельно. Боец в прицеле развёрнут на цель и при
 * этом ходит боком и назад: ровно под это в San Andreas сняты `GunMove_L/R/BWD`, и
 * аниматору нужен вектор движения в системе персонажа, а не только скорость.
 */

const YAW_TURN_RATE = 9;
const TWO_PI = Math.PI * 2;

/** Кратчайшая разница двух азимутов, со знаком. */
function wrapAngle(angle) {
  let delta = angle % TWO_PI;
  if (delta > Math.PI) delta -= TWO_PI;
  if (delta < -Math.PI) delta += TWO_PI;
  return delta;
}

function lerpAngle(from, to, t) {
  return from + wrapAngle(to - from) * t;
}

export function createPursuer({ x, z, yaw = 0, worldRadius, pathFree }) {
  const position = { x, z };
  // Шаг и обход отвечают в одни и те же объекты: их спрашивают каждый кадр у каждого бойца.
  const course = { dx: 0, dz: 0 };
  const step = { x: 0, z: 0, yaw: 0, speed: 0, moveDir: { x: 0, z: 1 }, aimYaw: 0 };
  let heading = yaw;
  let sidestepLeft = 0;
  let sidestepSign = 1;
  let stuckFor = 0;

  function speedFor(order, weapon) {
    if (order.run) return PLAYER.runSpeed * 0.7;
    return PLAYER.aimSpeed * (weapon?.moveSpeedFactor ?? 1);
  }

  /** Куда шагать: на цель, а пока идёт обход, под углом к ней. */
  function steer(dx, dz, dt) {
    sidestepLeft -= dt;
    course.dx = dx;
    course.dz = dz;
    if (sidestepLeft <= 0) return course;
    const angle = BOT.sidestepAngle * sidestepSign;
    course.dx = dx * Math.cos(angle) - dz * Math.sin(angle);
    course.dz = dx * Math.sin(angle) + dz * Math.cos(angle);
    return course;
  }

  /**
   * Упёрся и не едет, значит обходить.
   *
   * Ход есть, а продвижения нет только если на пути преграда: тогда направление на время
   * доворачивается вбок, и боец обтекает препятствие вместо того, чтобы тереться о стену.
   * Сравнивать надо пройденное с задуманным, а не задуманное с самим собой: пока путь
   * не проверялся у мира, эти два числа были равны и обход не включался никогда.
   */
  function trackStuck(moved, wanted, dt) {
    if (wanted > 0 && moved < wanted * BOT.stuckProgress) {
      stuckFor += dt;
      if (stuckFor > BOT.stuckSeconds && sidestepLeft <= 0) {
        sidestepLeft = BOT.sidestepSeconds;
        sidestepSign = -sidestepSign;
        stuckFor = 0;
      }
      return;
    }
    stuckFor = 0;
  }

  function update(dt, order, weapon) {
    const toX = order.x - position.x;
    const toZ = order.z - position.z;
    const distance = Math.hypot(toX, toZ);
    const speed = distance > BOT.arriveRadius ? speedFor(order, weapon) : 0;
    const reach = Math.min(speed * dt, distance);
    steer(toX / (distance || 1), toZ / (distance || 1), dt);
    // Коллайдера у бойца нет, поэтому вместо тела у него спрос к миру: сколько метров в эту
    // сторону свободно. Без этого он проходит сквозь дом и сквозь ящик, за которым прячется.
    const free = pathFree ? pathFree(position.x, position.z, course.dx, course.dz, reach) : reach;
    trackStuck(free, reach, dt);

    const beforeX = position.x;
    const beforeZ = position.z;
    position.x += course.dx * free;
    position.z += course.dz * free;
    const fromCenter = Math.hypot(position.x, position.z);
    if (fromCenter > worldRadius) {
      position.x *= worldRadius / fromCenter;
      position.z *= worldRadius / fromCenter;
    }

    const facing = order.face
      ? Math.atan2(order.face.x - position.x, order.face.z - position.z)
      : Math.atan2(course.dx, course.dz);
    if (speed > 0 || order.face) {
      heading = lerpAngle(heading, facing, Math.min(YAW_TURN_RATE * dt, 1));
    }

    const movedX = position.x - beforeX;
    const movedZ = position.z - beforeZ;
    const moved = Math.hypot(movedX, movedZ);
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    step.x = position.x;
    step.z = position.z;
    step.yaw = heading;
    step.speed = dt > 0 ? moved / dt : 0;
    // Направление шага в системе персонажа: он смотрит вдоль своего +Z.
    step.moveDir.x = moved > 0 ? (movedX * cos - movedZ * sin) / moved : 0;
    step.moveDir.z = moved > 0 ? (movedX * sin + movedZ * cos) / moved : 1;
    // Остаток разворота отыгрывают корпус и рука, иначе ствол смотрит мимо цели.
    step.aimYaw = order.face ? wrapAngle(facing - heading) : 0;
    return step;
  }

  return {
    update,
    position,
    /** Взять бойца там, где он стоит: иначе первый же приказ телепортирует его к себе домой. */
    moveTo(spot) {
      position.x = spot.x;
      position.z = spot.z;
    },
  };
}
