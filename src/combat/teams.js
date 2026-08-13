/**
 * Фракции: единственное место, где решается, кто кому враг.
 *
 * Команда приходит из записи мира. Записи без команды это мирное население: оно никогда не
 * стреляет и в перестрелке только разбегается.
 */

const FRIENDLY_FIRE = false;

export const CIVIL = 'civil';

const TEAMS = {
  ballas: { name: 'Ballas', color: '#b98cff' },
  grove: { name: 'Grove Street', color: '#5ddc7a' },
  cops: { name: 'Полиция', color: '#5aa9ff' },
  [CIVIL]: { name: 'Мирные', color: '#9aa0a6' },
};

const HOSTILE = {
  ballas: ['grove', 'cops'],
  grove: ['ballas', 'cops'],
  cops: ['ballas', 'grove'],
  [CIVIL]: [],
};

/** Фракции, которые вообще воюют: по ним строится счёт. */
export const FIGHTING_TEAMS = Object.keys(HOSTILE).filter((team) => HOSTILE[team].length);

export function teamName(team) {
  return TEAMS[team]?.name ?? TEAMS[CIVIL].name;
}

export function teamColor(team) {
  return TEAMS[team]?.color ?? TEAMS[CIVIL].color;
}

export function isHostile(attacker, target) {
  return Boolean(attacker && target && HOSTILE[attacker]?.includes(target));
}

/** Дружественный огонь выключен: банда из четырёх человек иначе выкашивает себя сама. */
export function canDamage(attacker, target) {
  if (attacker === target && !FRIENDLY_FIRE) return false;
  return FRIENDLY_FIRE || isHostile(attacker, target);
}
