import * as THREE from 'three';
import { loadModelData } from '../objects/gltf.js';
import { WEAPONS, weaponByKey } from './weapons.js';
import { createCombatHud } from '../hud/combat-hud.js';
import { createCrosshair } from '../hud/crosshair.js';

const WEAPON_KEY = 'KeyG';
const RELOAD_KEY = 'KeyR';
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
const TRACER_LIFETIME = 0.07;
const TRACER_COLOR = '#ffe9a8';
const FLASH_LIFETIME = 0.05;
const MUZZLE_LIGHT_COLOR = '#ffca7a';
const MUZZLE_LIGHT_INTENSITY = 40;
const MUZZLE_LIGHT_RANGE = 8;
const RESERVE_MAGAZINES = 5;
const AUTO_FIRE_CYCLE = 0.2;
const TARGET_SCAN_INTERVAL = 0.1;
// Пока у аниматора нет клипа перезарядки, магазин набивается по этому таймеру.
const RELOAD_FALLBACK_SECONDS = 1.6;

/** Секунды на цикл выстрела: отрезок клипа, который игра проигрывает на каждый патрон. */
function fireCycle(weapon) {
  return weapon.fireTo - weapon.fireFrom;
}

/**
 * Очередь при зажатой кнопке.
 *
 * Флаг continuousFire в поставляемом weapon.dat не выставлен ни у одного ствола, поэтому
 * очередь читается ещё и по длине петли клипа: у АК петля в четыре кадра, это уже очередь,
 * а не одиночный выстрел с доводкой.
 */
function isAutomatic(weapon) {
  return weapon.flags.continuousFire || fireCycle(weapon) <= AUTO_FIRE_CYCLE;
}

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

/** Отрезок из двух вершин, который каждый выстрел переставляет, а не создаёт заново. */
function buildTracer() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: TRACER_COLOR, transparent: true, opacity: 0.9 }),
  );
  // Отсечение по объёму сняли: границы у геометрии переезжают вместе с выстрелом, а считать
  // их заново на каждый кадр ради двух вершин дороже, чем нарисовать.
  line.frustumCulled = false;
  line.visible = false;
  return line;
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

export function createCombat({
  scene, camera, renderer, npcSystem, ragdolls, player, audio, isEditing,
}) {
  const gun = buildGun();
  gun.visible = false;
  const hand = mountGun(gun, player.mesh);
  let muzzleFlash = null;
  let flashLeft = 0;

  const hud = createCombatHud();
  const crosshair = createCrosshair();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const aimPoint = new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2);
  const lastPosition = new THREE.Vector3().copy(player.position());
  const magazines = new Map();
  // Трассер и подсветка выстрела заводятся один раз на всю игру. Каждый выстрел раньше
  // добавлял в сцену новый источник света, а от этого three пересобирает шейдеры всех
  // материалов сцены: отсюда и брался рывок ровно в момент нажатия.
  const tracer = buildTracer();
  const muzzleLight = new THREE.PointLight(MUZZLE_LIGHT_COLOR, 0, MUZZLE_LIGHT_RANGE);
  scene.add(tracer, muzzleLight);
  let weapon = WEAPONS[0];
  let armed = false;
  let cooldown = 0;
  let reloadLeft = 0;
  let scanLeft = 0;
  let tracerLeft = 0;
  let lightLeft = 0;
  let triggerHeld = false;
  let triggerPressed = false;

  /** Патроны считаются по стволам, чтобы смена оружия не сбрасывала расход. */
  function ammoOf(target) {
    if (!magazines.has(target.id)) {
      magazines.set(target.id, {
        mag: target.magazine,
        reserve: target.magazine * RESERVE_MAGAZINES,
      });
    }
    return magazines.get(target.id);
  }

  function showAmmo() {
    hud.setAmmo({ ...ammoOf(weapon), capacity: weapon.magazine });
  }

  function equip(next) {
    weapon = next;
    player.setWeapon?.(next);
    cancelReload();
    hud.setWeapon(next);
    crosshair.setWeapon(next);
    showAmmo();
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
    }).catch((error) => console.warn(`модель ${next.model} не загрузилась`, error));
  }

  function refreshCrosshair() {
    crosshair.setActive(armed && document.pointerLockElement === renderer.domElement);
  }

  document.addEventListener('pointerlockchange', refreshCrosshair);

  function setArmed(next) {
    armed = next;
    gun.visible = armed;
    hud.setArmed(armed);
    if (!armed) cancelReload();
    npcSystem.setCardEnabled(!armed);
    refreshCrosshair();
  }

  function fillMagazine() {
    const ammo = ammoOf(weapon);
    const taken = Math.min(weapon.magazine - ammo.mag, ammo.reserve);
    ammo.mag += taken;
    ammo.reserve -= taken;
    showAmmo();
  }

  function needsAmmo() {
    const ammo = ammoOf(weapon);
    return ammo.mag < weapon.magazine && ammo.reserve > 0;
  }

  /**
   * Перезарядка идёт ровно столько, сколько длится клип у аниматора.
   *
   * Пока клипа нет, метода player.reload может не быть вовсе, тогда работает таймер-заглушка.
   */
  function startReload() {
    if (!weapon.flags.reload || reloadLeft > 0 || !needsAmmo()) return;
    reloadLeft = player.reload?.() || RELOAD_FALLBACK_SECONDS;
    audio.reload(weapon, muzzleWorld());
    hud.setReloading(true);
  }

  function cancelReload() {
    reloadLeft = 0;
    hud.setReloading(false);
  }

  // У дробовика клипа перезарядки нет (флаг reload не выставлен): патрон досылается внутри
  // самого выстрела, поэтому магазин набивается сам, как только цикл отыграл.
  function chamberNext() {
    if (weapon.flags.reload || cooldown > 0 || !needsAmmo()) return;
    fillMagazine();
  }

  function muzzleWorld() {
    // Матрицы костей пересчитываются при рендере, поэтому перед чтением их надо обновить,
    // иначе трассер вылетает из позиции прошлого кадра.
    gun.updateWorldMatrix(true, false);
    if (muzzleFlash) return muzzleFlash.getWorldPosition(new THREE.Vector3());
    return gun.localToWorld(MUZZLE_LOCAL.clone());
  }

  function showTracer(from, to) {
    const points = tracer.geometry.getAttribute('position');
    points.setXYZ(0, from.x, from.y, from.z);
    points.setXYZ(1, to.x, to.y, to.z);
    points.needsUpdate = true;
    tracer.visible = true;
    tracerLeft = TRACER_LIFETIME;

    muzzleLight.position.copy(from);
    muzzleLight.intensity = MUZZLE_LIGHT_INTENSITY;
    lightLeft = FLASH_LIFETIME;
  }

  /** Луч из центра экрана, а без захвата мыши из точки последнего клика. */
  function aimHits() {
    const locked = document.pointerLockElement === renderer.domElement;
    const clientX = locked ? window.innerWidth / 2 : aimPoint.x;
    const clientY = locked ? window.innerHeight / 2 : aimPoint.y;
    pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    raycaster.far = weapon.range;
    return raycaster.intersectObjects(npcSystem.objects, true);
  }

  function npcIdOf(object) {
    let node = object;
    while (node && !node.userData.npcId) node = node.parent;
    return node?.userData.npcId ?? null;
  }

  function shoot() {
    ammoOf(weapon).mag -= 1;
    showAmmo();

    const hits = aimHits();
    const from = muzzleWorld();
    const to = hits.length
      ? hits[0].point
      : raycaster.ray.at(weapon.range, new THREE.Vector3());
    showTracer(from, to);
    audio.shot(weapon, from);
    audio.impact(to, hits.length ? 'body' : 'ground');
    player.kick?.();
    if (muzzleFlash) {
      muzzleFlash.visible = true;
      flashLeft = MUZZLE_FLASH_LIFETIME;
    }
    crosshair.kick();
    cooldown = fireCycle(weapon);

    const npcId = hits.length ? npcIdOf(hits[0].object) : null;
    if (!npcId) return;
    crosshair.hit();
    const victim = npcSystem.kill(npcId);
    if (!victim) return;
    ragdolls.spawn(victim.object, {
      impulse: raycaster.ray.direction,
      hitPoint: hits[0].point,
    });
    victim.stopAnimation?.();
    crosshair.frag();
    hud.addKill(victim.entry.name);
  }

  function playerSpeed(dt) {
    const { x, y, z } = player.position();
    const moved = dt > 0 ? Math.hypot(x - lastPosition.x, z - lastPosition.z) / dt : 0;
    lastPosition.set(x, y, z);
    return moved;
  }

  window.addEventListener('keydown', (event) => {
    if (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || isEditing()) return;
    if (event.code === WEAPON_KEY) {
      setArmed(!armed);
      return;
    }
    if (event.code === RELOAD_KEY) {
      if (armed) startReload();
      return;
    }
    const chosen = weaponByKey(event.code);
    if (!chosen) return;
    if (chosen !== weapon) equip(chosen);
    if (!armed) setArmed(true);
  });

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    aimPoint.set(event.clientX, event.clientY);
    triggerHeld = true;
    triggerPressed = true;
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) triggerHeld = false;
  });
  window.addEventListener('blur', () => {
    triggerHeld = false;
  });

  function update(dt) {
    cooldown = Math.max(0, cooldown - dt);
    chamberNext();
    if (reloadLeft > 0) {
      reloadLeft = Math.max(0, reloadLeft - dt);
      if (!reloadLeft) {
        fillMagazine();
        hud.setReloading(false);
      }
    }

    const wantsShot = isAutomatic(weapon) ? triggerHeld : triggerPressed;
    const pulled = triggerPressed;
    triggerPressed = false;
    if (wantsShot && armed && !isEditing() && !reloadLeft && !cooldown) {
      if (ammoOf(weapon).mag) shoot();
      else {
        // Щелчок по пустому патроннику звучит на нажатие, а не каждый кадр под зажатой кнопкой.
        if (pulled) audio.dryFire(muzzleWorld());
        startReload();
      }
    }

    crosshair.update(dt, playerSpeed(dt));
    scanLeft -= dt;
    if (scanLeft <= 0) {
      scanLeft = TARGET_SCAN_INTERVAL;
      crosshair.setTarget(armed && aimHits().length > 0);
    }

    if (flashLeft > 0) {
      flashLeft -= dt;
      if (flashLeft <= 0 && muzzleFlash) muzzleFlash.visible = false;
    }
    if (tracerLeft > 0) {
      tracerLeft -= dt;
      if (tracerLeft <= 0) tracer.visible = false;
    }
    if (lightLeft > 0) {
      lightLeft -= dt;
      if (lightLeft <= 0) muzzleLight.intensity = 0;
    }
  }

  equip(weapon);

  return { update, get armed() { return armed; } };
}
