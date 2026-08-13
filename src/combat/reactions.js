import { CIVIL } from './teams.js';

/**
 * Событие в реакцию, взвешенным выбором.
 *
 * Форма взята у самой San Andreas: в `data/Decision/*.ped` на каждое событие лежит до трёх
 * кандидатов-задач с вероятностями. Сами файлы не парсятся, они адресуют задачи движка
 * числовыми id, которых у нас нет. Взята только форма, числа наши, и их видно целиком.
 *
 * Выбор идёт из зерна бойца, а не из Math.random: одинаковая перестрелка должна
 * воспроизводиться, иначе разбираться, почему бот полез под пули, придётся на глаз.
 */

const REACTIONS = {
  gang: {
    enemySeen: { engage: 0.85, reposition: 0.15 },
    damage: { engage: 0.6, reposition: 0.3, retreat: 0.1 },
    allyDied: { engage: 0.6, reposition: 0.4 },
  },
  cops: {
    enemySeen: { engage: 0.9, reposition: 0.1 },
    damage: { engage: 0.75, reposition: 0.25 },
    allyDied: { engage: 1 },
  },
  [CIVIL]: {
    enemySeen: { flee: 1 },
    damage: { flee: 1 },
    allyDied: { flee: 1 },
  },
};

const PROFILE_OF_TEAM = { ballas: 'gang', grove: 'gang', cops: 'cops', [CIVIL]: CIVIL };

export function react(team, event, roll) {
  const table = REACTIONS[PROFILE_OF_TEAM[team] ?? CIVIL][event];
  if (!table) return null;
  let left = roll;
  for (const [reaction, weight] of Object.entries(table)) {
    left -= weight;
    if (left <= 0) return reaction;
  }
  return Object.keys(table)[0];
}
