import catalog from './weapons.json';

/**
 * Арсенал: связка «данные San Andreas плюс наши файлы».
 *
 * Числа и поведение целиком из weapon.dat (генерируется `tools/gta/weapondat.py`), тут
 * лежит только то, чего в игровых данных нет: путь к нашей модели, клавиша и имя клипа.
 *
 * Кадры animLoop это ключ ко всей стрельбе. Прицельная поза не отдельный клип, а тот же
 * клип выстрела, замороженный на кадре `start`. Выстрел проигрывает отрезок `start..end`.
 * Так это сделано в самой игре, поэтому своих поз рисовать не нужно.
 */

const SKILL = 'std';
const CLIP_FPS = 30;
const AUTO_FIRE_CYCLE = 0.2;
const SINGLE_BULLET = 1;

/**
 * Дробь и кучность в weapon.dat не описаны: San Andreas держит их в коде движка, а не в
 * данных. Поэтому число картечин и множитель разброса живут здесь, рядом с моделью и
 * клипом, то есть среди прочего, чего в игровых данных нет.
 */
const OURS = {
  PISTOL: { id: 'pistol', name: 'Пистолет', model: 'assets/models/weapons/pistol.glb',
            fireClip: 'colt45_fire', reloadClip: 'colt45_reload', key: 'Digit1' },
  DESERT_EAGLE: { id: 'deagle', name: 'Desert Eagle', model: 'assets/models/weapons/deagle.glb',
                  fireClip: 'python_fire', reloadClip: 'python_reload', key: 'Digit2' },
  SHOTGUN: { id: 'shotgun', name: 'Дробовик', model: 'assets/models/weapons/shotgun.glb',
             fireClip: 'shotgun_fire', reloadClip: null, key: 'Digit3',
             bullets: 8, spreadFactor: 3.4 },
  AK47: { id: 'ak47', name: 'АК-47', model: 'assets/models/weapons/ak47.glb',
          fireClip: 'RIFLE_fire', reloadClip: 'RIFLE_load', key: 'Digit4' },
  M4: { id: 'm4', name: 'M4', model: 'assets/models/weapons/m4.glb',
        fireClip: 'RIFLE_fire', reloadClip: 'RIFLE_load', key: 'Digit5' },
  // У винтовки в данных снят canAim: в San Andreas она целится только через оптику от
  // первого лица. Оптики у нас нет, а стрелять из неё надо, поэтому целится она как все,
  // по кадру из клипа выстрела. Это единственное место, где мы спорим с weapon.dat.
  COUNTRYRIFLE: { id: 'rifle', name: 'Винтовка', model: 'assets/models/weapons/rifle.glb',
                  fireClip: 'RIFLE_fire', reloadClip: 'RIFLE_load', key: 'Digit6',
                  spreadFactor: 0.4, flags: { canAim: true } },
};

function build(datName, ours) {
  const skills = catalog[datName].skills;
  const stats = skills[SKILL] ?? Object.values(skills)[0];
  const { start, end } = stats.animLoop;
  return {
    ...ours,
    // Группа из weapon.dat: ею сама игра различала звук кольта, помпы и винтовки.
    group: stats.group,
    damage: stats.damage,
    range: stats.weaponRange,
    // Дальность боя и дальность пули в San Andreas разные числа: с targetRange ИИ открывает
    // огонь, до weaponRange пуля вообще летит. У пистолета это 30 и 35.
    targetRange: stats.targetRange,
    magazine: stats.magazine,
    accuracy: stats.accuracy,
    moveSpeedFactor: stats.moveSpeed,
    flags: { ...stats.flags, ...ours.flags },
    bullets: ours.bullets ?? SINGLE_BULLET,
    spreadFactor: ours.spreadFactor ?? 1,
    // Кадры переводятся в секунды один раз здесь: аниматор работсо временем, не с кадрами.
    aimTime: start / CLIP_FPS,
    fireFrom: start / CLIP_FPS,
    fireTo: end / CLIP_FPS,
  };
}

export const WEAPONS = Object.entries(OURS).map(([datName, ours]) => build(datName, ours));

export function weaponByKey(code) {
  return WEAPONS.find((weapon) => weapon.key === code) ?? null;
}

export function weaponById(id) {
  return WEAPONS.find((weapon) => weapon.id === id) ?? WEAPONS[0];
}

/** Секунды на цикл выстрела: отрезок клипа, который игра проигрывает на каждый патрон. */
export function fireCycle(weapon) {
  return weapon.fireTo - weapon.fireFrom;
}

/**
 * Очередь при зажатой кнопке.
 *
 * Флаг continuousFire в поставляемом weapon.dat не выставлен ни у одного ствола (F-051),
 * поэтому очередь читается ещё и по длине петли клипа: у АК петля в четыре кадра, это уже
 * очередь, а не одиночный выстрел с доводкой.
 */
export function isAutomatic(weapon) {
  return weapon.flags.continuousFire || fireCycle(weapon) <= AUTO_FIRE_CYCLE;
}
