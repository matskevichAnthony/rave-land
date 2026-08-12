import { createKillfeed } from './killfeed.js';

const LOW_AMMO_SHARE = 0.25;

/** HUD боя: ствол, боезапас, фраги и киллфид. Разметка лежит в index.html. */
export function createCombatHud() {
  const element = document.querySelector('[data-combat]');
  const weaponName = element.querySelector('[data-weapon-name]');
  const ammo = element.querySelector('[data-ammo]');
  const magazine = element.querySelector('[data-ammo-mag]');
  const reserve = element.querySelector('[data-ammo-reserve]');
  const reloading = element.querySelector('[data-reloading]');
  const frags = element.querySelector('[data-frags]');
  const killfeed = createKillfeed();
  let killed = 0;

  return {
    setArmed(armed) {
      element.hidden = !armed;
    },
    setWeapon(weapon) {
      weaponName.textContent = weapon.name;
    },
    setAmmo({ mag, reserve: left, capacity }) {
      magazine.textContent = mag;
      reserve.textContent = left;
      ammo.classList.toggle('combat__ammo--low', mag <= capacity * LOW_AMMO_SHARE);
    },
    setReloading(active) {
      reloading.hidden = !active;
      element.classList.toggle('combat--reloading', active);
    },
    addKill(victim) {
      killed += 1;
      frags.textContent = killed;
      killfeed.push(victim);
    },
  };
}
