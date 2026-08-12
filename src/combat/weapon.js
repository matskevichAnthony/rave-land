import * as THREE from 'three';
import { loadModelData } from '../objects/gltf.js';
import { WEAPONS, weaponByKey } from './weapons.js';

const WEAPON_KEY = 'KeyG';
const MUZZLE_NODE = 'gunflash';
const MUZZLE_FLASH_LIFETIME = 0.05;
const GUN_OFFSET = new THREE.Vector3(0.27, 0.82, 0.12);
const GUN_GRIP_OFFSET = new THREE.Vector3(0, 0.08, 0.03);
const GUN_GRIP_PITCH = -Math.PI / 2;
// GLTFLoader runs node names through sanitizeNodeName, so the GTA skeleton's
// "R Hand" reaches the scene as "R_Hand".
const HAND_BONE_NAMES = ['hand.R', 'handR', 'hand_R', 'Hand_R', 'RightHand', 'mixamorigRightHand',
                         'R_Hand'];
const MUZZLE_LOCAL = new THREE.Vector3(0, 0.03, 0.26);
const SHOT_COOLDOWN = 0.25;
const TRACER_LIFETIME = 0.07;
const FLASH_LIFETIME = 0.05;

/**
 * Модель оружия из GTA вместо процедурной заглушки.
 *
 * Оружие в San Andreas авторено прямо в системе кости правой кисти, единичной матрицей:
 * подбирать смещение, поворот и масштаб не нужно, достаточно вложить модель в кость.
 * Второй меш в файле это вспышка у дула (узел gunflash): она гасится сразу и зажигается
 * на кадр по выстрелу, иначе торчит из ствола постоянно. Файла может не быть, тогда
 * остаётся процедурный ствол и игра работает без ассетов GTA вообще.
 */
async function loadWeaponModel(src) {
  const { scene } = await loadModelData(src);
  const model = scene.clone(true);
  let flash = null;
  model.traverse((child) => {
    if (child.isMesh && child.name.toLowerCase() === MUZZLE_NODE) flash = child;
  });
  return { model, flash };
}

/**
 * Развернуть оружие так, чтобы ствол смотрел вдоль кости кисти.
 *
 * Модель авторена в системе фрейма кисти, а кость в скелете живёт в своей: импортёр
 * доворачивает её, потому что Blender держит кость вдоль одной оси, а RenderWare вдоль
 * другой. Поправку можно было бы записать константой, но она развалится на другом
 * скелете, поэтому она выводится из данных: куда смотрит ствол, говорит узел вспышки, а
 * куда смотрит кисть, говорит её дочерняя кость. Годится для любой модели и любого рига.
 */
function alignToHand(gun, flash, hand) {
  const child = hand.children.find((node) => node.isBone);
  if (!flash || !child) return;
  gun.quaternion.identity();
  gun.updateWorldMatrix(true, true);
  // Оба направления берутся в локальной системе: ствол переводится в систему самого узла
  // оружия, а положение дочерней кости в ней уже и лежит, потому что её родитель кисть.
  const barrel = gun.worldToLocal(flash.getWorldPosition(new THREE.Vector3())).normalize();
  const along = child.position.clone().normalize();
  if (barrel.lengthSq() && along.lengthSq()) gun.quaternion.setFromUnitVectors(barrel, along);
}

function buildGun() {
  const gun = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#23222c', roughness: 0.6 });
  const gripMaterial = new THREE.MeshStandardMaterial({ color: '#3a3242', roughness: 0.9 });

  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.24), metal);
  barrel.position.set(0, 0.03, 0.12);
  gun.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.12, 0.06), gripMaterial);
  grip.position.set(0, -0.045, 0.02);
  grip.rotation.x = 0.25;
  gun.add(grip);

  return gun;
}

function findRightHand(root) {
  for (const name of HAND_BONE_NAMES) {
    const bone = root.getObjectByName(name);
    if (bone) return bone;
  }
  let found = null;
  root.traverse((child) => {
    // Side marker sits at either end of the name: "hand.R" but also "R Hand".
    if (!found && child.isBone && /hand/i.test(child.name)
        && /right|[._\- ]r$|^r[._\- ]/i.test(child.name)) {
      found = child;
    }
  });
  return found;
}

function mountGun(gun, playerMesh) {
  const hand = findRightHand(playerMesh);
  if (!hand) {
    gun.position.copy(GUN_OFFSET);
    playerMesh.add(gun);
    return null;
  }
  playerMesh.updateWorldMatrix(true, true);
  const handScale = hand.getWorldScale(new THREE.Vector3()).y || 1;
  gun.scale.setScalar(1 / handScale);
  gun.position.copy(GUN_GRIP_OFFSET);
  gun.rotation.x = GUN_GRIP_PITCH;
  hand.add(gun);
  return hand;
}

export function createCombat({ scene, camera, renderer, npcSystem, ragdolls, player, isEditing }) {
  const gun = buildGun();
  gun.visible = false;
  const hand = mountGun(gun, player.mesh);
  let muzzleFlash = null;
  let flashLeft = 0;

  let weapon = WEAPONS[0];

  function equip(next) {
    weapon = next;
    player.setWeapon?.(next);
    loadWeaponModel(next.model).then(({ model, flash }) => {
      if (weapon !== next) return;
      gun.clear();
      // Подобранные под процедурный ствол хват и масштаб сбрасываются: модель из GTA уже
      // стоит там, где нужно, относительно кости кисти.
      gun.position.set(0, 0, 0);
      gun.rotation.set(0, 0, 0);
      gun.scale.setScalar(1);
      gun.add(model);
      muzzleFlash = flash;
      alignToHand(gun, flash, hand);
      if (muzzleFlash) muzzleFlash.visible = false;
      updateHud();
    }).catch((error) => console.warn(`модель ${next.model} не загрузилась`, error));
  }

  function updateHud() {
    weaponHud.textContent = `${weapon.name}: урон ${weapon.damage}, магазин ${weapon.magazine}`
      + `, дальность ${weapon.range} м${weapon.flags.moveFire ? ', стрельба на ходу' : ''}`;
  }

  const weaponHud = document.querySelector('[data-weapon]');
  const crosshair = document.querySelector('[data-crosshair]');
  equip(weapon);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const effects = [];
  let armed = false;
  let cooldown = 0;

  function refreshCrosshair() {
    const locked = document.pointerLockElement === renderer.domElement;
    crosshair.hidden = !locked;
    crosshair.classList.toggle('crosshair--armed', armed);
  }

  document.addEventListener('pointerlockchange', refreshCrosshair);

  function setArmed(next) {
    armed = next;
    gun.visible = armed;
    weaponHud.hidden = !armed;
    updateHud();
    npcSystem.setCardEnabled(!armed);
    refreshCrosshair();
  }

  function muzzleWorld() {
    // Матрицы костей пересчитываются при рендере, поэтому перед чтением их надо обновить,
    // иначе трассер вылетает из позиции прошлого кадра.
    gun.updateWorldMatrix(true, false);
    if (muzzleFlash) return muzzleFlash.getWorldPosition(new THREE.Vector3());
    return gun.localToWorld(MUZZLE_LOCAL.clone());
  }

  function spawnTracer(from, to) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.9 }),
    );
    scene.add(line);
    effects.push({ object: line, ttl: TRACER_LIFETIME });

    const flash = new THREE.PointLight('#ffca7a', 40, 8);
    flash.position.copy(from);
    scene.add(flash);
    effects.push({ object: flash, ttl: FLASH_LIFETIME });
  }

  function shoot(event) {
    const locked = document.pointerLockElement === renderer.domElement;
    const clientX = locked ? window.innerWidth / 2 : event.clientX;
    const clientY = locked ? window.innerHeight / 2 : event.clientY;
    pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    raycaster.far = weapon.range;
    const hits = raycaster.intersectObjects(npcSystem.objects, true);
    const from = muzzleWorld();
    const to = hits.length
      ? hits[0].point
      : raycaster.ray.at(weapon.range, new THREE.Vector3());
    spawnTracer(from, to);
    player.kick?.();
    if (muzzleFlash) {
      muzzleFlash.visible = true;
      flashLeft = MUZZLE_FLASH_LIFETIME;
    }

    if (hits.length) {
      let node = hits[0].object;
      while (node && !node.userData.npcId) node = node.parent;
      if (node) {
        const victim = npcSystem.kill(node.userData.npcId);
        if (victim) {
          ragdolls.spawn(victim.object, {
            impulse: raycaster.ray.direction,
            hitPoint: hits[0].point,
          });
          victim.stopAnimation?.();
        }
      }
    }
    cooldown = SHOT_COOLDOWN;
  }

  window.addEventListener('keydown', (event) => {
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || isEditing()) return;
    if (event.code === WEAPON_KEY) {
      setArmed(!armed);
      return;
    }
    const chosen = weaponByKey(event.code);
    if (!chosen) return;
    if (chosen !== weapon) equip(chosen);
    if (!armed) setArmed(true);
  });

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (!armed || isEditing() || event.button !== 0 || cooldown > 0) return;
    shoot(event);
  });

  function update(dt) {
    cooldown = Math.max(0, cooldown - dt);
    if (flashLeft > 0) {
      flashLeft -= dt;
      if (flashLeft <= 0 && muzzleFlash) muzzleFlash.visible = false;
    }
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      effects[i].ttl -= dt;
      if (effects[i].ttl <= 0) {
        scene.remove(effects[i].object);
        effects.splice(i, 1);
      }
    }
  }

  return { update, get armed() { return armed; } };
}
