const LOW_AMMO_SHARE = 0.25;

/**
 * Панель ствола: оружие, боезапас, перезарядка. Разметка лежит в index.html.
 *
 * Значения приходят каждый кадр, а в DOM уезжают только изменившиеся: запись в textContent
 * заставляет браузер пересчитывать разметку, и делать это шестьдесят раз в секунду ради
 * одного и того же числа не за что.
 */
export function createCombatHud() {
  const element = document.querySelector('[data-combat]');
  const weaponName = element.querySelector('[data-weapon-name]');
  const ammo = element.querySelector('[data-ammo]');
  const magazine = element.querySelector('[data-ammo-mag]');
  const reserve = element.querySelector('[data-ammo-reserve]');
  const reloading = element.querySelector('[data-reloading]');
  const shown = { mag: null, reserve: null, low: null, reloading: null };

  return {
    setArmed(armed) {
      element.hidden = !armed;
    },
    setWeapon(weapon) {
      weaponName.textContent = weapon.name;
    },
    setAmmo({ mag, reserve: left, capacity }) {
      if (mag !== shown.mag) magazine.textContent = shown.mag = mag;
      if (left !== shown.reserve) reserve.textContent = shown.reserve = left;
      const low = mag <= capacity * LOW_AMMO_SHARE;
      if (low === shown.low) return;
      shown.low = low;
      ammo.classList.toggle('combat__ammo--low', low);
    },
    setReloading(active) {
      if (active === shown.reloading) return;
      shown.reloading = active;
      reloading.hidden = !active;
      element.classList.toggle('combat--reloading', active);
    },
    setDead(dead) {
      element.classList.toggle('combat--dead', dead);
    },
  };
}
