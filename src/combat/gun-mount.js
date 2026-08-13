import * as THREE from 'three';
import { loadModelData } from '../objects/gltf.js';

/**
 * Ствол в руке персонажа: одинаково для игрока и для бота.
 *
 * Оружие в San Andreas авторено прямо в системе кости правой кисти, единичной матрицей
 * (F-047): подбирать смещение, поворот и масштаб не нужно, достаточно вложить модель в
 * кость. Второй меш в файле это вспышка у дула (узел gunflash): она гасится сразу и
 * зажигается на кадр по выстрелу, иначе торчит из ствола постоянно.
 */

const MUZZLE_NODE = 'gunflash';
const MUZZLE_FLASH_SECONDS = 0.05;
const MUZZLE_FALLBACK = new THREE.Vector3(0, 0.03, 0.26);
const HAND_FALLBACK_OFFSET = new THREE.Vector3(0.27, 0.82, 0.12);
const GRIP_OFFSET = new THREE.Vector3(0, 0.08, 0.03);
const GRIP_PITCH = -Math.PI / 2;
// GLTFLoader прогоняет имена узлов через sanitizeNodeName, поэтому гташный «R Hand»
// доезжает до сцены как «R_Hand», а наш «hand.R» как «handR».
const HAND_BONE_NAMES = ['hand.R', 'handR', 'hand_R', 'Hand_R', 'RightHand', 'mixamorigRightHand',
                         'R_Hand'];

async function loadWeaponModel(src) {
  const { scene } = await loadModelData(src);
  const model = scene.clone(true);
  let flash = null;
  model.traverse((child) => {
    if (child.isMesh && child.name.toLowerCase() === MUZZLE_NODE) flash = child;
  });
  return { model, flash };
}

function findRightHand(root) {
  for (const name of HAND_BONE_NAMES) {
    const bone = root.getObjectByName(name);
    if (bone) return bone;
  }
  let found = null;
  root.traverse((child) => {
    // Сторона стоит на любом конце имени: и «hand.R», и «R Hand».
    if (!found && child.isBone && /hand/i.test(child.name)
        && /right|[._\- ]r$|^r[._\- ]/i.test(child.name)) {
      found = child;
    }
  });
  return found;
}

/**
 * Развернуть оружие так, чтобы ствол смотрел вдоль кости кисти.
 *
 * Поправку можно было бы записать константой, но она развалится на другом скелете, поэтому
 * она выводится из данных: куда смотрит ствол, говорит узел вспышки, а куда смотрит кисть,
 * говорит её дочерняя кость. Годится для любой модели и любого рига (F-049).
 */
function alignToHand(gun, flash, hand) {
  const child = hand?.children.find((node) => node.isBone);
  if (!flash || !child) return;
  gun.quaternion.identity();
  gun.updateWorldMatrix(true, true);
  const barrel = gun.worldToLocal(flash.getWorldPosition(new THREE.Vector3())).normalize();
  const along = child.position.clone().normalize();
  if (barrel.lengthSq() && along.lengthSq()) gun.quaternion.setFromUnitVectors(barrel, along);
}

function buildFallbackGun() {
  const gun = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#23222c', roughness: 0.6 });
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.24), metal);
  barrel.position.set(0, 0.03, 0.12);
  gun.add(barrel);
  return gun;
}

export function createGunMount(characterRoot) {
  const gun = new THREE.Group();
  gun.visible = false;
  const hand = findRightHand(characterRoot);
  if (hand) {
    characterRoot.updateWorldMatrix(true, true);
    const handScale = hand.getWorldScale(new THREE.Vector3()).y || 1;
    gun.scale.setScalar(1 / handScale);
    gun.position.copy(GRIP_OFFSET);
    gun.rotation.x = GRIP_PITCH;
    hand.add(gun);
  } else {
    gun.position.copy(HAND_FALLBACK_OFFSET);
    characterRoot.add(gun);
  }

  let muzzleFlash = null;
  let flashLeft = 0;
  let equipped = null;

  /** Ствол из ассетов GTA, а без него процедурная заглушка: игра работает и без них. */
  function equip(weapon) {
    equipped = weapon;
    loadWeaponModel(weapon.model).then(({ model, flash }) => {
      if (equipped !== weapon) return;
      gun.clear();
      gun.position.set(0, 0, 0);
      gun.rotation.set(0, 0, 0);
      gun.scale.setScalar(1);
      gun.add(model);
      muzzleFlash = flash;
      alignToHand(gun, flash, hand);
      if (muzzleFlash) muzzleFlash.visible = false;
    }).catch(() => {
      if (equipped !== weapon || gun.children.length) return;
      gun.add(buildFallbackGun());
    });
  }

  /**
   * Точка вылета пули в мире.
   *
   * Мировые матрицы костей пересчитываются при рендере, поэтому перед чтением их надо
   * обновить: иначе выстрел уходит из позиции прошлого кадра и на быстром развороте вспышка
   * отстаёт от ствола (R7).
   */
  function muzzle(target) {
    gun.updateWorldMatrix(true, false);
    if (muzzleFlash) return muzzleFlash.getWorldPosition(target);
    return target.copy(MUZZLE_FALLBACK).applyMatrix4(gun.matrixWorld);
  }

  function flash() {
    if (!muzzleFlash) return;
    muzzleFlash.visible = true;
    flashLeft = MUZZLE_FLASH_SECONDS;
  }

  function update(dt) {
    if (flashLeft <= 0) return;
    flashLeft -= dt;
    if (flashLeft <= 0 && muzzleFlash) muzzleFlash.visible = false;
  }

  return {
    equip,
    muzzle,
    flash,
    update,
    setVisible: (visible) => {
      gun.visible = visible;
    },
  };
}
