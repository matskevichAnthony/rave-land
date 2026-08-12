import { PLAYER } from '../config.js';

const REFERENCE_RANGE = 35;
const MIN_SPREAD = 5;
const SPREAD_UNIT = 7;
const MOVE_SPREAD = 12;
const SHOT_SPREAD = 8;
const MAX_SPREAD = 46;
const SHOT_RECOVERY = 34;
const MOTION_SETTLE = 6;
const HIT_SECONDS = 0.14;
const FRAG_SECONDS = 0.4;

/**
 * Базовый развод штрихов по данным ствола.
 *
 * Чем ниже точность, тем шире стоит прицел; дальнобойность тянет штрихи обратно к центру,
 * потому что ствол для дальнего боя должен читаться собраннее автомата ближнего боя.
 */
function baseSpread({ accuracy, range }) {
  return MIN_SPREAD + SPREAD_UNIT / (accuracy * Math.sqrt(range / REFERENCE_RANGE));
}

export function createCrosshair() {
  const element = document.querySelector('[data-crosshair]');
  let base = 0;
  let motion = 0;
  let shot = 0;
  let hitLeft = 0;
  let fragLeft = 0;

  function fade(left, dt, modifier) {
    if (left <= 0) return 0;
    const next = left - dt;
    if (next <= 0) element.classList.remove(modifier);
    return Math.max(0, next);
  }

  return {
    setWeapon(weapon) {
      base = baseSpread(weapon);
    },
    setActive(active) {
      element.hidden = !active;
      if (!active) element.classList.remove('crosshair--target');
    },
    setTarget(onTarget) {
      element.classList.toggle('crosshair--target', onTarget);
    },
    kick() {
      shot = Math.min(MAX_SPREAD, shot + SHOT_SPREAD);
    },
    hit() {
      element.classList.add('crosshair--hit');
      hitLeft = HIT_SECONDS;
    },
    frag() {
      element.classList.add('crosshair--frag');
      fragLeft = FRAG_SECONDS;
    },
    update(dt, speed) {
      shot = Math.max(0, shot - SHOT_RECOVERY * dt);
      const running = Math.min(1, speed / PLAYER.runSpeed) * MOVE_SPREAD;
      motion += (running - motion) * Math.min(1, dt * MOTION_SETTLE);
      hitLeft = fade(hitLeft, dt, 'crosshair--hit');
      fragLeft = fade(fragLeft, dt, 'crosshair--frag');
      const spread = Math.min(MAX_SPREAD, base + motion + shot);
      element.style.setProperty('--crosshair-spread', `${spread.toFixed(1)}px`);
    },
  };
}
