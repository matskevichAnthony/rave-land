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

const OURS = {
  PISTOL: { id: 'pistol', name: 'Пистолет', model: 'assets/models/weapons/pistol.glb',
            fireClip: 'colt45_fire', reloadClip: 'colt45_reload', key: 'Digit1' },
  DESERT_EAGLE: { id: 'deagle', name: 'Desert Eagle', model: 'assets/models/weapons/deagle.glb',
                  fireClip: 'python_fire', reloadClip: 'python_reload', key: 'Digit2' },
  SHOTGUN: { id: 'shotgun', name: 'Дробовик', model: 'assets/models/weapons/shotgun.glb',
             fireClip: 'shotgun_fire', reloadClip: null, key: 'Digit3' },
  AK47: { id: 'ak47', name: 'АК-47', model: 'assets/models/weapons/ak47.glb',
          fireClip: 'RIFLE_fire', reloadClip: 'RIFLE_load', key: 'Digit4' },
};

function build(datName, ours) {
  const skills = catalog[datName].skills;
  const stats = skills[SKILL] ?? Object.values(skills)[0];
  const { start, end, fire } = stats.animLoop;
  return {
    ...ours,
    damage: stats.damage,
    range: stats.weaponRange,
    magazine: stats.magazine,
    accuracy: stats.accuracy,
    moveSpeedFactor: stats.moveSpeed,
    flags: stats.flags,
    // Кадры переводятся в секунды один раз здесь: аниматор работсо временем, не с кадрами.
    aimTime: start / CLIP_FPS,
    fireFrom: start / CLIP_FPS,
    fireTo: end / CLIP_FPS,
    shotTime: fire / CLIP_FPS,
  };
}

export const WEAPONS = Object.entries(OURS).map(([datName, ours]) => build(datName, ours));

export function weaponByKey(code) {
  return WEAPONS.find((weapon) => weapon.key === code) ?? null;
}
