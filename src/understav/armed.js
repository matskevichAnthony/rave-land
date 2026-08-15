import { createGunMount } from '../combat/gun-mount.js';
import { weaponById } from '../combat/weapons.js';

/**
 * Ствол в руке гуляющего по промо-сцене: тот же приём, что и в основном мире.
 *
 * Ни стрельбы, ни урона тут нет: оружие вкладывается в кость кисти, а поза приезжает из
 * того же клипа выстрела, замороженного на прицельном кадре, поэтому персонаж держит
 * пистолет, а не носит его приклеенным к бедру.
 */

const DEFAULT_WEAPON = 'pistol';

export function attachWeapon({ model, weapon = weaponById(DEFAULT_WEAPON) }) {
  const mount = createGunMount(model);
  mount.equip(weapon);
  mount.setVisible(true);

  return {
    weapon,
    /** Дописать в позу персонажа то, что делает его вооружённым: аниматор читает оба поля. */
    writePose(pose, aiming = true) {
      pose.weapon = weapon;
      pose.aiming = aiming;
    },
    update: (dt) => mount.update(dt),
    setVisible: (visible) => mount.setVisible(visible),
  };
}
