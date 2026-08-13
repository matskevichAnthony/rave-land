import * as THREE from 'three';
import { BOT, COMBAT, PLAYER } from '../config.js';
import { PLAYER_ID, createFighters } from './fighters.js';
import { createPerception } from '../npc/perception.js';
import { buildCoverPoints } from '../npc/cover.js';
import { createRay } from './ray.js';
import { createTracers } from './tracers.js';
import { resolveShot } from './shooting.js';
import { applyDamage } from './damage.js';
import { createScoreboard } from './scoreboard.js';
import { weaponById } from './weapons.js';
import { isHostile } from './teams.js';
import { emit, on } from './events.js';
import { mulberry32 } from '../terrain/heightfield.js';

/**
 * Режим перестрелки: кто сегодня боец, кто в кого попал и кто когда вернётся.
 *
 * Арена только сводит вместе готовые части: реестр бойцов, восприятие, решение о попадании,
 * урон и счёт. Своей логики боя здесь нет, и это нарочно: каждую часть можно чинить и
 * смотреть отдельно, а связку видно одним файлом.
 *
 * Бой считается фиксированным шагом 30 Гц, отдельно от кадра. Иначе на просевшем кадре
 * очередь становится реже, а разброс шире, то есть бой начинает зависеть от машины.
 */

const ALLY_ALERT_RADIUS = 25;
// Рабочие вектора и списки заводятся один раз на модуль: выстрел бывает по нескольку раз в
// шаг, и объекты на выстрел это мусор в самом занятом месте кадра.
const CORPSE_IMPULSE = new THREE.Vector3();
const shotOrigin = new THREE.Vector3();
const shotAim = new THREE.Vector3();
const gunPoint = new THREE.Vector3();
const targets = [];
const visible = [];
const look = { distance: 0, fighter: null };

export function createArena({
  RAPIER, physicsWorld, scene, terrain, npcSystem, ragdolls, audio, coverObjects, playerCollider,
}) {
  const fighters = createFighters();
  const ray = createRay({ RAPIER, physicsWorld, ignoreCollider: playerCollider });
  const perception = createPerception({ ray, fighters });
  const tracers = createTracers(scene);
  const scoreboard = createScoreboard();
  const cover = buildCoverPoints(coverObjects);
  const spawns = [];
  const rngById = new Map();
  // Что мозгам нужно знать о мире, собирается один раз: шаг боя идёт тридцать раз в секунду.
  const thinkContext = { fighters, perception, cover };
  let player = null;
  let active = false;
  let accumulator = 0;
  let shotsFired = 0;

  function rngOf(fighter) {
    if (!rngById.has(fighter.id)) rngById.set(fighter.id, mulberry32(fighter.seed));
    return rngById.get(fighter.id);
  }

  function setSpawns(points) {
    spawns.length = 0;
    spawns.push(...points);
  }

  /** Точка возрождения: заданная в мире, а не домашняя позиция бойца, иначе арену не настроить. */
  function spawnFor(fighter) {
    if (!spawns.length) return { x: fighter.x, z: fighter.z };
    const random = rngOf(fighter);
    const friendly = spawns.filter((spot) => !spot.team || spot.team === fighter.team);
    const pool = friendly.length ? friendly : spawns;
    return pool[Math.floor(random() * pool.length) % pool.length];
  }

  function registerPlayer(adapter) {
    player = adapter;
    return fighters.add({
      id: PLAYER_ID,
      team: PLAYER.team,
      name: PLAYER.name,
      weapon: adapter.weapon(),
      isPlayer: true,
      seed: 1,
    });
  }

  /** Боец за NPC. Возвращённый после смерти получает свою же запись: её уже подняли. */
  function addBot({ id, team, name, weapon, seed, hp }) {
    return fighters.get(id)
      ?? fighters.add({ id, team, name, weapon: weaponById(weapon), seed, maxHp: hp });
  }

  /**
   * Выстрел одного бойца: луч, трассер, звук, урон.
   *
   * Точка вылета берётся у самого ствола, а направление у того, кто стреляет: игроку его
   * даёт камера, боту цель. Дальше оба идут одной дорогой, поэтому пуля бота ведёт себя как
   * пуля игрока, включая разброс и стены.
   */
  function fire(fighter) {
    // Бот, которого ещё не собрал респавн, стрелять не может: пули у него нет, значит и
    // выстрела не было. Мёртвый молчит по той же причине: убить его мог тот же самый шаг,
    // в котором он нажал спуск.
    const source = fighter.isPlayer ? player : npcSystem.combatant(fighter.id);
    if (!source || !fighter.alive) return;
    shotsFired += 1;
    source.muzzle(shotOrigin);
    source.aim(shotAim);
    targets.length = 0;
    for (const other of fighters.all()) {
      if (other.alive && other !== fighter && isHostile(fighter.team, other.team)) {
        targets.push(other);
      }
    }

    // Картечь это тот же выстрел, посчитанный несколько раз: разброс каждой пуле считается
    // заново, поэтому облако получается само собой, без отдельного кода на дробовик.
    const rng = rngOf(fighter);
    let shot = null;
    let struck = false;
    let victim = null;
    for (let bullet = 0; bullet < fighter.weapon.bullets; bullet += 1) {
      shot = resolveShot(
        { ray, shooter: fighter, origin: shotOrigin, aim: shotAim, targets, rng });
      tracers.spawn(shotOrigin, shot.point);
      if (!shot.target) continue;
      struck = true;
      victim = shot.target;
      applyDamage(fighters, {
        attackerId: fighter.id,
        targetId: shot.target.id,
        zone: shot.zone,
        weapon: fighter.weapon,
        direction: shot.direction,
        point: shot.point,
      });
    }

    source.flash();
    audio.shot(fighter.weapon, shotOrigin);
    // Звук попадания один на выстрел, а не на каждую картечину: восемь щелчков подряд
    // слышны как треск, а не как попадание.
    audio.impact(shot.point, struck ? 'body' : 'ground');
    // Крик тоже один на выстрел и идёт от груди раненого: восемь картечин это одно попадание
    // для того, в кого попали, а голос у него один.
    if (victim) audio.pain(gunPointOf(victim), !victim.alive);
    emit('shot', { fighter, point: shot.point });
  }

  on('death', ({ target, direction, point }) => {
    for (const ally of fighters.all()) {
      if (ally === target || !ally.alive || ally.team !== target.team) continue;
      if (Math.hypot(ally.x - target.x, ally.z - target.z) < ALLY_ALERT_RADIUS) ally.allyDown = true;
    }
    if (target.isPlayer) {
      player.die();
      return;
    }
    const corpse = npcSystem.die(target.id);
    if (!corpse) return;
    CORPSE_IMPULSE.copy(direction);
    ragdolls.spawn(corpse.object, { impulse: CORPSE_IMPULSE, hitPoint: point });
    corpse.stopAnimation?.();
    perception.forget(target.id);
  });

  function respawn(fighter) {
    const spot = spawnFor(fighter);
    const y = terrain.heightAt(spot.x, spot.z);
    fighters.revive(fighter, { x: spot.x, y, z: spot.z });
    if (fighter.isPlayer) player.respawn(spot);
    else npcSystem.respawn(fighter.id, spot);
    emit('respawn', { fighter });
  }

  /** Где у бойца железо: щелчок и лязг слышны от ствола, а не из-под ног. */
  function gunPointOf(fighter) {
    return gunPoint.set(fighter.x, fighter.y + COMBAT.chestHeight, fighter.z);
  }

  /**
   * Шаг боя. Стрелять игрок может всегда, воюют боты только в режиме перестрелки.
   *
   * Поэтому восприятие и мозги считаются только под включённым режимом, а спуск, патроны и
   * урон работают одинаково: мир вне режима остаётся мирным, но не бутафорским.
   */
  function fixedStep(dt) {
    player.sample(fighters.get(PLAYER_ID));
    if (active) {
      perception.step(dt);
      npcSystem.think(dt, thinkContext);
    }
    for (const fighter of fighters.step(dt)) fire(fighter);
    for (const fighter of fighters.all()) {
      if (fighter.dryFired) audio.dryFire(gunPointOf(fighter));
      if (fighter.reloadStarted) audio.reload(fighter.weapon, gunPointOf(fighter));
      if (!fighter.alive && fighter.respawnLeft <= 0) respawn(fighter);
    }
  }

  /**
   * Включение режима: вне его мир остаётся мирным, как был.
   *
   * Это не только игровой переключатель, но и способ отлаживать по отдельности: с выключенным
   * боем видно, что сломалось не в бою.
   */
  function setActive(next) {
    active = next;
    accumulator = 0;
    npcSystem.setCombat(next);
    if (next) return;
    for (const fighter of fighters.all()) {
      fighter.intent.fire = false;
      fighter.intent.aim = false;
    }
  }

  function update(dt) {
    tracers.update(dt);
    // Накопитель ограничен сверху: после долгого провала кадра бой не должен догонять
    // десятком шагов подряд, лучше потерять время, чем встать колом.
    accumulator = Math.min(accumulator + dt, COMBAT.stepSeconds * 4);
    while (accumulator >= COMBAT.stepSeconds) {
      accumulator -= COMBAT.stepSeconds;
      fixedStep(COMBAT.stepSeconds);
    }
  }

  /**
   * Что под прицелом: ближайшая преграда или боец на луче.
   *
   * Тем же ответом живут две вещи: подсветка прицела и точка схождения для выстрела. Камера
   * стоит за плечом, поэтому стрелять по её направлению из ствола значит мазать вблизи;
   * правильное направление это от дула к тому, что видно в перекрестье.
   */
  function lookAt(origin, direction, range) {
    const wall = ray.world(origin, direction, range);
    // Список кандидатов и ответ переиспользуются: под прицел смотрят каждый кадр.
    visible.length = 0;
    for (const fighter of fighters.all()) {
      if (fighter.alive && !fighter.isPlayer) visible.push(fighter);
    }
    const found = ray.fighter(origin, direction, wall ?? range, visible);
    look.distance = found ? found.distance : (wall ?? range);
    look.fighter = found?.fighter ?? null;
    return look;
  }

  return {
    fighters,
    scoreboard,
    lookAt,
    registerPlayer,
    addBot,
    setSpawns,
    update,
    toggle: () => setActive(!active),
    get active() {
      return active;
    },
    stats: () => ({
      fighters: fighters.all().length,
      alive: fighters.all().filter((fighter) => fighter.alive).length,
      sightRaysPerSecond: perception.raysPerSecond(),
      shotsFired,
      coverPoints: cover.length,
      viewRange: BOT.viewRange,
    }),
  };
}
