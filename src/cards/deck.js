/**
 * Пульт генератора афиш: сиды, хаос, цвет, направление, формат и выгрузка.
 *
 * Ряды кнопок строятся перебором списка направлений и словаря форматов, а не выписаны в
 * разметке: добавили направление файлом в `directions`, и кнопка появилась сама. Второго
 * списка названий, который разъедется с первым, в проекте нет.
 *
 * Тумблеры хаоса и цветовые колодцы не держат своего состояния: правда живёт в `view`
 * страницы, пульт только показывает её через `showState`. Так кнопка не разъезжается с
 * карточками после любого пути перерисовки.
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
  pick('new-lay').addEventListener('click', actions.newLay);
  pick('new-tex').addEventListener('click', actions.newTex);
  pick('new-bg').addEventListener('click', actions.newBg);
  pick('copy-seed').addEventListener('click', actions.copySeed);
  pick('save-all').addEventListener('click', actions.saveAll);
  pick('allow-3d').addEventListener('click', actions.toggle3d);
  pick('chaos').addEventListener('click', actions.toggleChaos);
  pick('madness').addEventListener('click', actions.toggleMadness);
  pick('plaque').addEventListener('click', actions.togglePlaque);
  pick('text-name').addEventListener('click', actions.toggleName);
  pick('text-meta').addEventListener('click', actions.toggleMeta);
  pick('text-credit').addEventListener('click', actions.toggleCredit);

  const hotWell = pick('ink-hot');
  const coldWell = pick('ink-cold');
  const applyInks = () => actions.setInks(hotWell.value, coldWell.value);
  hotWell.addEventListener('input', applyInks);
  coldWell.addEventListener('input', applyInks);
  pick('ink-reset').addEventListener('click', actions.resetInks);

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
    showState(state) {
      pick('allow-3d').classList.toggle(ACTIVE_CLASS, state.allow3d);
      pick('chaos').classList.toggle(ACTIVE_CLASS, state.chaos);
      pick('madness').classList.toggle(ACTIVE_CLASS, state.madness);
      pick('plaque').classList.toggle(ACTIVE_CLASS, state.plaque);
      pick('text-name').classList.toggle(ACTIVE_CLASS, state.showName);
      pick('text-meta').classList.toggle(ACTIVE_CLASS, state.showMeta);
      pick('text-credit').classList.toggle(ACTIVE_CLASS, state.showCredit);
      hotWell.value = state.hot;
      coldWell.value = state.cold;
    },
    note(text) {
      pick('note').textContent = text;
    },
  };
}
