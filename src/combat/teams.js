/**
 * Фракции: единственное место, где решается, кто кому враг.
 *
 * Команда приходит из записи мира. Записи без команды это мирное население: оно никогда не
 * стреляет и в перестрелке только разбегается.
 */

const FRIENDLY_FIRE = false;

export const CIVIL = 'civil';

/**
 * Фракция это имя, цвет и характер. Характером фракции пользуется таблица реакций, и живёт
 * он здесь же: пока он лежал отдельным списком, новая банда получала поведение мирных,
 * то есть целилась во врага и не стреляла, потому что в том списке её просто не было.
 */
const TEAMS = {
  ballas: { name: 'Ballas', color: '#b98cff', temper: 'gang' },
  grove: { name: 'Grove Street', color: '#5ddc7a', temper: 'gang' },
  cops: { name: 'Полиция', color: '#5aa9ff', temper: 'cops' },
  aztecas: { name: 'Aztecas', color: '#3fe0d0', temper: 'gang' },
  triads: { name: 'Триады', color: '#ff8a5c', temper: 'gang' },
  [CIVIL]: { name: 'Мирные', color: '#9aa0a6', temper: CIVIL },
};

/**
 * Фракции, которые вообще воюют: по ним строится счёт, и из них же выводится вражда.
 *
 * Союзов в этом мире нет, каждый против каждого, поэтому таблицы «кто кому враг» тут нет:
 * рукописная копия того же знания разошлась бы с этим списком на первой же новой банде.
 */
export const FIGHTING_TEAMS = Object.keys(TEAMS).filter((team) => team !== CIVIL);

export function teamName(team) {
  return TEAMS[team]?.name ?? TEAMS[CIVIL].name;
}

export function teamColor(team) {
  return TEAMS[team]?.color ?? TEAMS[CIVIL].color;
}

/** Характер фракции: по нему выбирается реакция на выстрел, потерю и вид врага. */
export function teamTemper(team) {
  return TEAMS[team]?.temper ?? CIVIL;
}

export function isHostile(attacker, target) {
  return attacker !== target
    && FIGHTING_TEAMS.includes(attacker) && FIGHTING_TEAMS.includes(target);
}

/** Дружественный огонь выключен: банда из четырёх человек иначе выкашивает себя сама. */
export function canDamage(attacker, target) {
  if (attacker === target && !FRIENDLY_FIRE) return false;
  return FRIENDLY_FIRE || isHostile(attacker, target);
}
