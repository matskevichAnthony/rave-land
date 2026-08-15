import * as THREE from 'three';
import { WEAPONS, isAutomatic, weaponByKey } from './weapons.js';
import { createGunMount } from './gun-mount.js';
import { createCombatHud } from '../hud/combat-hud.js';
import { createCrosshair } from '../hud/crosshair.js';
import { createPlayerIntent } from '../player/intent.js';
import { isTyping } from '../player/input.js';
import { isHostile } from './teams.js';
import { on } from './events.js';

/**
 * Игрок как боец: ввод превращается в намерение, всё остальное решает арена.
 *
 * Здесь не считаются ни попадания, ни здоровье, ни патроны: этим владеет реестр бойцов, и
 * читать их можно только оттуда. Файл остался адаптером ввода и отображения, а бой у игрока
 * и у бота теперь буквально один и тот же код.
 */

const WEAPON_KEY = 'KeyG';
const TARGET_SCAN_INTERVAL = 0.1;

export function createPlayerCombat({
  camera, domElement, player, followCam, arena, npcSystem, isEditing,
}) {
  const mount = createGunMount(player.mesh);
  const hud = createCombatHud();
  const crosshair = createCrosshair();
  const input = createPlayerIntent({ domElement, isEditing });
  const muzzlePoint = new THREE.Vector3();
  const lookDirection = new THREE.Vector3();
  const lookPoint = new THREE.Vector3();
  const aimDirection = new THREE.Vector3(0, 0, 1);
  let weapon = WEAPONS[0];
  let armed = false;
  let scanLeft = 0;
  let underCrosshair = null;

  /**
   * Снимок игрока для реестра: позиция от стоп, разворот, скорость и намерение.
   *
   * Намерение пишется именно здесь, потому что арена зовёт снимок из шага боя. Раньше оно
   * писалось в кадре, и нажатия гасли: шаг идёт 30 раз в секунду, кадр 60 и чаще, поэтому
   * клик, попавший между шагами, стирался следующим кадром, не дойдя до спуска.
   */
  function sample(record) {
    const { x, y, z } = player.position();
    record.x = x;
    record.y = y - player.feetOffset;
    record.z = z;
    record.yaw = followCam.azimuth() + Math.PI;
    record.speed = player.speed();
    record.crouching = player.crouching();
    input.write(record.intent, {
      armed: armed && record.alive && !isEditing(),
      automatic: isAutomatic(weapon),
      aimPitch: followCam.aimPitch(),
    });
  }

  function refreshCrosshair() {
    crosshair.setActive(armed && document.pointerLockElement === domElement);
  }

  function setArmed(next) {
    armed = next;
    mount.setVisible(armed);
    hud.setArmed(armed);
    // Карточка NPC открывается тем же левым кликом, что и стрельба: со стволом в руках она
    // не должна выскакивать на каждый выстрел.
    npcSystem.setCardEnabled(!armed);
    refreshCrosshair();
  }

  const fighter = arena.registerPlayer({
    weapon: () => weapon,
    sample,
    muzzle: (target) => mount.muzzle(target),
    aim: (target) => target.copy(aimDirection),
    flash: () => mount.flash(),
    die: () => {
      setArmed(false);
      hud.setDead(true);
    },
    respawn: (spot) => {
      player.teleport(spot.x, spot.z);
      hud.setDead(false);
      setArmed(true);
    },
  });

  /**
   * Куда полетит пуля: от дула к тому, что видно в перекрестье.
   *
   * Камера стоит за плечом и выше, поэтому направление камеры и направление ствола это разные
   * вещи. Схождение считается по тому, во что упирается взгляд, и вблизи ствол смотрит именно
   * туда, куда наведён прицел, а не мимо на ширину плеча.
   */
  function updateAim() {
    camera.getWorldDirection(lookDirection);
    mount.muzzle(muzzlePoint);
    const seen = arena.lookAt(camera.position, lookDirection, weapon.range);
    lookPoint.copy(camera.position).addScaledVector(lookDirection, seen.distance);
    aimDirection.copy(lookPoint).sub(muzzlePoint).normalize();
    underCrosshair = seen.fighter;
  }

  function equip(next) {
    weapon = next;
    fighter.weapon = next;
    fighter.ammo = Math.min(fighter.ammo, next.magazine);
    hud.setWeapon(next);
    crosshair.setWeapon(next);
    mount.equip(next);
  }

  // Своё попадание подсвечивается прицелом, свой фраг им же, но ярче: это единственная
  // обратная связь по чужому здоровью, полос над головами у врагов нет.
  on('hit', ({ attacker }) => {
    if (attacker === fighter) crosshair.hit();
  });
  on('death', ({ attacker }) => {
    if (attacker === fighter) crosshair.frag();
  });
  // Отдача расталкивает перекрестье на каждый свой выстрел: очередь навскидку должна стоить
  // точности, и видно это только по прицелу.
  on('shot', ({ fighter: shooter }) => {
    if (shooter === fighter) crosshair.kick();
  });

  document.addEventListener('pointerlockchange', refreshCrosshair);

  window.addEventListener('keydown', (event) => {
    if (isTyping(event) || isEditing()) return;
    if (event.code === WEAPON_KEY) {
      setArmed(!armed && fighter.alive);
      return;
    }
    const chosen = weaponByKey(event.code);
    if (!chosen || !fighter.alive) return;
    if (chosen !== weapon) equip(chosen);
    if (!armed) setArmed(true);
  });

  function update(dt) {
    updateAim();
    mount.update(dt);
    hud.setAmmo({ mag: fighter.ammo, reserve: fighter.reserve, capacity: weapon.magazine });
    hud.setReloading(fighter.reloadLeft > 0);
    crosshair.update(dt, fighter.speed);
    scanLeft -= dt;
    if (scanLeft <= 0) {
      scanLeft = TARGET_SCAN_INTERVAL;
      crosshair.setTarget(
        armed && Boolean(underCrosshair) && isHostile(fighter.team, underCrosshair.team));
    }
  }

  equip(weapon);

  return {
    update,
    fighter,
    get armed() {
      return armed && fighter.alive;
    },
  };
}
