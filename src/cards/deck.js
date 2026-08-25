/**
 * Пульт генератора афиш: сид, направление, формат и выгрузка.
 *
 * Ряды кнопок строятся перебором списка направлений и словаря форматов, а не выписаны в
 * разметке: добавили направление файлом в `directions`, и кнопка появилась сама. Второго
 * списка названий, который разъедется с первым, в проекте нет.
 */

import { create } from '../ui/dom.js';
import { DIRECTIONS } from './directions/index.js';
import { FORMATS } from './format.js';

const ACTIVE_CLASS = 'is-active';

export function createDeck({ root, event, view, actions }) {
  const pick = (hook) => root.querySelector(`[data-js-${hook}]`);

  pick('event').textContent = event.event;
  pick('lineup').textContent = event.lineup.join(' / ');

  mountChoice(pick('directions'), DIRECTIONS, view.direction, actions.setDirection);
  mountChoice(
    pick('formats'),
    Object.entries(FORMATS).map(([id, format]) => ({ id, label: format.label })),
    view.format,
    actions.setFormat,
  );

  pick('new-seed').addEventListener('click', actions.newSeed);
  pick('copy-seed').addEventListener('click', actions.copySeed);
  pick('save-all').addEventListener('click', actions.saveAll);

  function mountChoice(holder, options, current, apply) {
    const buttons = options.map((option) => {
      const button = create('button', '', option.label);
      button.type = 'button';
      button.classList.toggle(ACTIVE_CLASS, option.id === current);
      button.addEventListener('click', () => {
        for (const other of buttons) other.classList.toggle(ACTIVE_CLASS, other === button);
        apply(option.id);
      });
      return button;
    });
    holder.append(...buttons);
  }

  return {
    showSeed(seed) {
      pick('seed').textContent = seed;
    },
    note(text) {
      pick('note').textContent = text;
    },
  };
}
