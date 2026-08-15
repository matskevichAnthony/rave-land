import { teamColor } from '../combat/teams.js';
import { ensure } from '../ui/dom.js';

const ROW_LIFETIME_MS = 5000;
const MAX_ROWS = 4;
const KILL_MARK = '✕';

const MARKUP = '<div class="killfeed" data-killfeed></div>';

/**
 * Кто кого убил. Пустой киллфид не занимает места, поэтому прятать его отдельно не нужно.
 *
 * Строки красятся по фракциям: в перестрелке на четыре стороны имена сами по себе ничего не
 * говорят, а цвет читается краем глаза.
 */
export function createKillfeed() {
  const element = ensure('[data-killfeed]', MARKUP);

  function nameOf(fighter) {
    const span = document.createElement('span');
    span.className = 'killfeed__name';
    span.style.color = teamColor(fighter.team);
    span.textContent = fighter.name;
    return span;
  }

  return {
    push(attacker, target) {
      const row = document.createElement('div');
      row.className = 'killfeed__row';
      if (attacker.isPlayer || target.isPlayer) row.classList.add('killfeed__row--mine');
      const mark = document.createElement('span');
      mark.className = 'killfeed__mark';
      mark.textContent = KILL_MARK;
      row.append(nameOf(attacker), ' ', mark, ' ', nameOf(target));
      element.append(row);
      while (element.children.length > MAX_ROWS) element.firstElementChild.remove();
      setTimeout(() => row.remove(), ROW_LIFETIME_MS);
    },
  };
}
