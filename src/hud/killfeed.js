const ROW_LIFETIME_MS = 4000;
const MAX_ROWS = 2;
const KILL_MARK = '✕';

/** Пустой киллфид не занимает места, поэтому прятать его отдельно не нужно. */
export function createKillfeed() {
  const element = document.querySelector('[data-killfeed]');

  return {
    push(victim) {
      const row = document.createElement('div');
      row.className = 'killfeed__row';
      const mark = document.createElement('span');
      mark.className = 'killfeed__mark';
      mark.textContent = KILL_MARK;
      row.append('Ты ', mark, ` ${victim}`);
      element.append(row);
      while (element.children.length > MAX_ROWS) element.firstElementChild.remove();
      setTimeout(() => row.remove(), ROW_LIFETIME_MS);
    },
  };
}
