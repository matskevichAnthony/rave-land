import * as THREE from 'three';
import { BOT, COMBAT } from '../config.js';
import { on } from '../combat/events.js';
import { CIVIL, isHostile } from '../combat/teams.js';

/**
 * Кого боец видит, с бюджетом лучей на шаг.
 *
 * Наивное «каждый проверяет каждого» стоит квадрата числа бойцов и растёт быстрее всего
 * остального в бою. Здесь луч один на бойца и не каждый шаг: бойцы обходятся по кругу, за
 * шаг тратится не больше `sightRaysPerStep` лучей, и цена перестаёт зависеть от населения
 * арены. Между лучами работает память: спрашивающий получает не «видно или нет», а сколько
 * времени прошло с последнего подтверждённого луча, и решает сам.
 *
 * Выбор цели живёт здесь же, потому что луч всё равно надо на кого-то потратить. Липкость
 * обязательна: без неё бот дёргается между двумя врагами и не попадает ни в кого.
 */

const eye = new THREE.Vector3();
const chest = new THREE.Vector3();
const toTarget = new THREE.Vector3();

export function createPerception({ ray, fighters }) {
  const sightById = new Map();
  // Списки и ответ переиспользуются: восприятие работает тридцать раз в секунду, и заводить
  // тут массивы значит кормить мусорщик ровно в самом частом месте боя.
  const watchers = [];
  const answer = { enemyId: null, lostFor: 0, distance: 0 };
  let cursor = 0;
  let now = 0;

  function sightOf(id) {
    if (!sightById.has(id)) {
      sightById.set(id, { enemyId: null, distance: 0, seenAt: -Infinity, chosenAt: -Infinity,
                          alertUntil: -Infinity });
    }
    return sightById.get(id);
  }

  // Попадание поднимает тревогу: обстрелянный смотрит на все стороны, и перестрелка
  // затягивает соседей, а не остаётся дуэлью двоих.
  on('hit', ({ target, attacker }) => {
    const sight = sightOf(target.id);
    sight.alertUntil = now + BOT.alertSeconds;
    if (!sight.enemyId && isHostile(target.team, attacker.team)) {
      sight.enemyId = attacker.id;
      sight.chosenAt = now;
    }
  });

  // Мирным война не по адресу, но выстрел рядом они слышат: тот, кто стрелял, становится для
  // них тем, от кого надо бежать. Это единственное, что мирный умеет в перестрелке.
  on('shot', ({ fighter }) => {
    for (const other of fighters.all()) {
      if (other.team !== CIVIL || !other.alive) continue;
      if (Math.hypot(other.x - fighter.x, other.z - fighter.z) > BOT.viewRange) continue;
      const sight = sightOf(other.id);
      sight.enemyId = fighter.id;
      sight.chosenAt = now;
      sight.seenAt = now;
      sight.distance = Math.hypot(other.x - fighter.x, other.z - fighter.z);
    }
  });

  function inView(watcher, candidate, sight) {
    const distance = Math.hypot(candidate.x - watcher.x, candidate.z - watcher.z);
    if (distance > BOT.viewRange) return null;
    if (now < sight.alertUntil) return distance;
    const heading = Math.atan2(Math.sin(watcher.yaw), Math.cos(watcher.yaw));
    const bearing = Math.atan2(candidate.x - watcher.x, candidate.z - watcher.z);
    const off = Math.abs(Math.atan2(Math.sin(bearing - heading), Math.cos(bearing - heading)));
    return off <= BOT.fieldOfView / 2 ? distance : null;
  }

  /** Кому тратить луч: своей цели, пока держится липкость, иначе ближайшему врагу в секторе. */
  function pickCandidate(watcher, sight, all) {
    const held = sight.enemyId ? fighters.get(sight.enemyId) : null;
    if (held?.alive && now - sight.chosenAt < BOT.targetHoldSeconds
        && inView(watcher, held, sight) !== null) {
      return held;
    }
    let best = null;
    let bestDistance = Infinity;
    for (const other of all) {
      if (other === watcher || !other.alive || !isHostile(watcher.team, other.team)) continue;
      const distance = inView(watcher, other, sight);
      if (distance === null || distance >= bestDistance) continue;
      bestDistance = distance;
      best = other;
    }
    return best ?? (held?.alive ? held : null);
  }

  function castSight(watcher, candidate) {
    eye.set(watcher.x, watcher.y + COMBAT.eyeHeight, watcher.z);
    chest.set(candidate.x, candidate.y + COMBAT.chestHeight, candidate.z);
    toTarget.copy(chest).sub(eye);
    const distance = toTarget.length();
    toTarget.divideScalar(distance || 1);
    const wall = ray.world(eye, toTarget, distance);
    return wall === null || wall >= distance - COMBAT.bodyRadius;
  }

  function step(dt) {
    now += dt;
    const all = fighters.all();
    watchers.length = 0;
    // Мирные лучей не тратят: им незачем проверять линию огня, они и так бегут от выстрела.
    for (const fighter of all) {
      if (fighter.alive && !fighter.isPlayer && fighter.team !== CIVIL) watchers.push(fighter);
    }
    let budget = Math.min(BOT.sightRaysPerStep, watchers.length);
    while (budget > 0) {
      budget -= 1;
      cursor = (cursor + 1) % watchers.length;
      const watcher = watchers[cursor];
      const sight = sightOf(watcher.id);
      const candidate = pickCandidate(watcher, sight, all);
      if (!candidate) {
        sight.enemyId = null;
        continue;
      }
      if (candidate.id !== sight.enemyId) {
        sight.enemyId = candidate.id;
        sight.chosenAt = now;
      }
      if (!castSight(watcher, candidate)) continue;
      sight.seenAt = now;
      sight.distance = Math.hypot(candidate.x - watcher.x, candidate.z - watcher.z);
    }
  }

  return {
    step,
    /** Цель бойца и насколько давно её подтверждал луч. Null, если цели нет вовсе. */
    target(id) {
      const sight = sightById.get(id);
      if (!sight?.enemyId) return null;
      answer.enemyId = sight.enemyId;
      answer.lostFor = now - sight.seenAt;
      answer.distance = sight.distance;
      return answer;
    },
    forget(id) {
      sightById.delete(id);
    },
    raysPerSecond: () => BOT.sightRaysPerStep / COMBAT.stepSeconds,
  };
}
