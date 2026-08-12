import { WEAPONS } from '../combat/weapons.js';
import { IMPACT_KINDS } from '../audio/impact.js';

/**
 * Опись боевых звуков: по ней рисуются кнопки стенда и по ней же идёт замер.
 *
 * Два списка разошлись бы на первой правке, поэтому список один, а способ его прожать
 * разный: живой контекст на кнопке и оффлайновый на измерении.
 */

export const SOURCE_AT = { x: 0, y: 1.5, z: -3 };

const IMPACT_TITLES = { body: 'тело', ground: 'бетон' };

export const SOUNDS = [
  ...WEAPONS.map((weapon) => ({
    id: `shot-${weapon.id}`,
    title: `Выстрел: ${weapon.name}`,
    play: (audio) => audio.shot(weapon, SOURCE_AT),
  })),
  ...WEAPONS.map((weapon) => ({
    id: `reload-${weapon.id}`,
    title: `Перезарядка: ${weapon.name}`,
    play: (audio) => audio.reload(weapon, SOURCE_AT),
  })),
  {
    id: 'dry-fire',
    title: 'Сухой щелчок',
    play: (audio) => audio.dryFire(SOURCE_AT),
  },
  ...IMPACT_KINDS.map((kind) => ({
    id: `impact-${kind}`,
    title: `Попадание: ${IMPACT_TITLES[kind] ?? kind}`,
    play: (audio) => audio.impact(SOURCE_AT, kind),
  })),
  {
    // Худший случай для лимитера: четыре выстрела ровно в один момент.
    id: 'volley',
    title: 'Залп: все стволы разом',
    play: (audio) => WEAPONS.forEach((weapon) => audio.shot(weapon, SOURCE_AT)),
  },
];
