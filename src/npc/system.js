import * as THREE from 'three';
import { buildCharacter } from '../characters/builder.js';
import { buildGltfCharacter } from './gltf-character.js';
import { createWanderer } from './wander.js';
import { createPursuer } from './pursue.js';
import { createBrain } from './combat-brain.js';
import { createNameLabel } from './label.js';
import { createInfoCard } from './info-card.js';
import { createGunMount } from '../combat/gun-mount.js';
import { CIVIL } from '../combat/teams.js';
import { STANCE } from '../combat/fighters.js';
import { COMBAT } from '../config.js';

const WORLD_RADIUS_FACTOR = 0.45;
const DEFAULT_WEAPON = 'pistol';
// Скелет из San Andreas это 32 кости, и каждая пересчитывается на каждом кадре у каждого
// персонажа. Вдали разницы между 60 и 15 обновлениями в секунду не видно, поэтому дальние
// считаются реже: пропущенное время копится и приходит одним шагом, походка не замедляется.
const ANIMATION_STEP = [
  { distance: 24, seconds: 0 },
  { distance: 55, seconds: 1 / 30 },
  { distance: Infinity, seconds: 1 / 12 },
];

function animationStep(distance) {
  return ANIMATION_STEP.find((step) => distance < step.distance).seconds;
}

export function createNpcSystem({ scene, camera, terrain, renderer }) {
  const npcs = new Map();
  const fallen = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const card = createInfoCard();
  const aimPoint = new THREE.Vector3();
  const worldRadius = terrain.params.size * WORLD_RADIUS_FACTOR;
  let cardEnabled = true;
  let arena = null;
  let fighting = false;

  function attachArena(next) {
    arena = next;
  }

  async function add(entry) {
    const { object, update, stopAnimation } = entry.src
      ? await buildGltfCharacter(entry.src)
      : await buildCharacter({ archetype: entry.archetype, seed: entry.seed });
    const [x, y, z] = entry.position;
    object.position.set(x, y ?? terrain.heightAt(x, z), z);
    object.userData.npcId = entry.id;
    object.add(createNameLabel(entry.name));
    scene.add(object);

    const team = entry.team ?? CIVIL;
    const armed = team !== CIVIL;
    const npc = {
      entry,
      object,
      animate: update,
      stopAnimation,
      team,
      wanderer: createWanderer({ seed: entry.seed, home: { x, z }, worldRadius }),
      pursuer: createPursuer({ x, z, worldRadius }),
      brain: createBrain({ seed: entry.seed, team }),
      mount: armed ? createGunMount(object) : null,
      fighter: arena?.addBot({
        id: entry.id, team, name: entry.name, seed: entry.seed,
        weapon: entry.weapon ?? DEFAULT_WEAPON, hp: entry.hp ?? COMBAT.maxHp,
      }) ?? null,
      order: null,
      // Поза заводится одна на персонажа: аниматору её отдают каждый кадр, а новый объект в
      // кадре на каждого NPC это мусор пропорционально населению.
      pose: { speed: 0, dancing: false, aiming: false, moveDir: { x: 0, z: 1 },
              aimYaw: 0, aimPitch: 0, weapon: null, shotId: 0, reloadId: 0,
              dead: false, hitT: 0 },
      pending: 0,
    };
    if (npc.fighter) {
      npc.fighter.x = x;
      npc.fighter.y = object.position.y;
      npc.fighter.z = z;
      npc.fighter.yaw = object.rotation.y;
    }
    if (npc.mount) {
      npc.mount.equip(npc.fighter.weapon);
      npc.mount.setVisible(fighting);
      npc.combatant = buildCombatant(npc);
    }
    npcs.set(entry.id, npc);
    return npc;
  }

  /**
   * Точка вылета и направление ствола бота: тем же входом, что и у игрока.
   *
   * Собирается один раз на бойца: арена спрашивает его на каждом выстреле, а новый объект на
   * выстрел это мусор ровно в тот момент, когда стреляет вся арена.
   */
  function buildCombatant(npc) {
    return {
      muzzle: (target) => npc.mount.muzzle(target),
      aim: (target) => {
        const at = npc.fighter.aimAt;
        npc.mount.muzzle(aimPoint);
        return at
          ? target.set(at.x - aimPoint.x, at.y - aimPoint.y, at.z - aimPoint.z).normalize()
          : target.set(Math.sin(npc.fighter.yaw), 0, Math.cos(npc.fighter.yaw));
      },
      flash: () => npc.mount.flash(),
    };
  }

  function stripSprites(object) {
    const sprites = [];
    object.traverse((child) => {
      if (child.isSprite) sprites.push(child);
    });
    for (const sprite of sprites) {
      sprite.removeFromParent();
      sprite.material.map.dispose();
      sprite.material.dispose();
    }
  }

  function remove(id) {
    const npc = npcs.get(id);
    if (!npc) return;
    scene.remove(npc.object);
    stripSprites(npc.object);
    npcs.delete(id);
    arena?.fighters.remove(id);
  }

  /**
   * Убитый уходит со сцены, но не из мира.
   *
   * Раньше на его месте вызывался kill и запись пропадала навсегда: респавн становился
   * невозможен, а сохранение мира посреди боя теряло NPC. Теперь запись живёт в списке
   * павших и возвращается тем же входом, что и обычное добавление.
   */
  function die(id) {
    const npc = npcs.get(id);
    if (!npc) return null;
    stripSprites(npc.object);
    npcs.delete(id);
    fallen.set(id, npc.entry);
    card.hide();
    return npc;
  }

  async function respawn(id, spot) {
    const entry = fallen.get(id) ?? npcs.get(id)?.entry;
    if (!entry) return;
    fallen.delete(id);
    npcs.delete(id);
    await add({ ...entry, position: [spot.x, null, spot.z] });
  }

  /** Шаг мышления: один на всех ботов, идёт из фиксированного шага боя, а не из кадра. */
  function think(dt, context) {
    if (!fighting) return;
    for (const npc of npcs.values()) {
      if (!npc.fighter) continue;
      npc.order = npc.brain.think(npc.fighter, dt, context);
    }
  }

  function setCombat(active) {
    fighting = active;
    for (const npc of npcs.values()) {
      npc.mount?.setVisible(active);
      npc.order = null;
      if (active || !npc.fighter) continue;
      npc.fighter.intent.aim = false;
      // Мирное блуждание начинается оттуда, где закончился бой, иначе персонаж прыгает на
      // ту точку, где его оставил wander до перестрелки.
      npc.wanderer = createWanderer({
        seed: npc.entry.seed,
        home: { x: npc.object.position.x, z: npc.object.position.z },
        worldRadius,
      });
    }
  }

  function driveCombat(npc, dt) {
    const step = npc.pursuer.update(dt, npc.order, npc.fighter.weapon);
    npc.pose.moveDir.x = step.moveDir.x;
    npc.pose.moveDir.z = step.moveDir.z;
    npc.pose.aimYaw = step.aimYaw;
    return step;
  }

  function drivePeace(npc, dt) {
    const step = npc.wanderer.update(dt);
    npc.pose.moveDir.x = 0;
    npc.pose.moveDir.z = 1;
    npc.pose.aimYaw = 0;
    // В режиме перестрелки боец не танцует, даже пока не нашёл врага: со стволом в руках это
    // читается как поломка, а не как шутка.
    npc.pose.dancing = step.state === 'dance' && !(fighting && npc.fighter);
    return step;
  }

  function writePose(npc, speed) {
    const { pose, fighter } = npc;
    pose.speed = speed;
    if (!fighter) return pose;
    pose.aiming = fighter.stance === STANCE.aiming || fighter.stance === STANCE.reloading;
    pose.weapon = fighter.weapon;
    pose.shotId = fighter.shotId;
    pose.reloadId = fighter.reloadId;
    pose.aimPitch = fighter.aimPitch;
    pose.hitT = fighter.hitT;
    pose.dead = !fighter.alive;
    if (pose.aiming) pose.dancing = false;
    return pose;
  }

  function update(dt) {
    for (const npc of npcs.values()) {
      const inCombat = fighting && npc.fighter?.alive && npc.order;
      const step = inCombat ? driveCombat(npc, dt) : drivePeace(npc, dt);
      const height = terrain.heightAt(step.x, step.z);
      npc.object.position.set(step.x, height, step.z);
      npc.object.rotation.y = step.yaw;
      if (npc.fighter) {
        npc.fighter.x = step.x;
        npc.fighter.y = height;
        npc.fighter.z = step.z;
        npc.fighter.yaw = step.yaw;
        npc.fighter.speed = step.speed;
      }
      npc.mount?.update(dt);

      npc.pending += dt;
      if (npc.pending < animationStep(npc.object.position.distanceTo(camera.position))) continue;
      npc.animate(npc.pending, writePose(npc, step.speed));
      npc.pending = 0;
    }
  }

  function serialize() {
    const living = [...npcs.values()].map(({ entry, object }) => ({
      ...entry,
      position: [object.position.x, null, object.position.z],
    }));
    // Павшие сохраняются вместе с живыми: иначе сохранение мира посреди боя теряет половину
    // населения арены.
    return [...living, ...fallen.values()];
  }

  function npcAt(clientX, clientY) {
    pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(objectsOf(), true);
    if (!hits.length) return null;
    let node = hits[0].object;
    while (node && !node.userData.npcId) node = node.parent;
    return node ? npcs.get(node.userData.npcId) : null;
  }

  function objectsOf() {
    return [...npcs.values()].map((npc) => npc.object);
  }

  function setCardEnabled(enabled) {
    cardEnabled = enabled;
    if (!enabled) card.hide();
  }

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !cardEnabled) return;
    const locked = document.pointerLockElement === renderer.domElement;
    const npc = locked
      ? npcAt(window.innerWidth / 2, window.innerHeight / 2)
      : npcAt(event.clientX, event.clientY);
    if (npc) {
      card.show(npc.entry);
    } else {
      card.hide();
    }
  });

  return {
    add,
    remove,
    die,
    respawn,
    think,
    setCombat,
    combatant: (id) => npcs.get(id)?.combatant ?? null,
    attachArena,
    setCardEnabled,
    update,
    serialize,
    get objects() {
      return objectsOf();
    },
    get count() {
      return npcs.size + fallen.size;
    },
  };
}
