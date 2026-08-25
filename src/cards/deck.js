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
import { BORDERS } from './border.js';
import { DIRECTIONS } from './directions/index.js';
import { FORMATS } from './format.js';
import { SCALE_RANGE, TEXT_ROLES } from './typeset.js';

const ACTIVE_CLASS = 'is-active';

// Тона объёма и зоны эффектора: словари пульта, id уходит в view как есть.
const OBJ_TONES = [
  { id: 'heat', label: 'Жар' },
  { id: 'cold', label: 'Холод' },
  { id: 'metal', label: 'Металл' },
  { id: 'mono', label: 'Моно' },
];
const CHAOS_ZONES = [
  { id: 'all', label: 'Весь кадр' },
  { id: 'bg', label: 'Только фон' },
  { id: 'text', label: 'Только текст' },
];

// Ползунки ходят в процентах, view держит доли.
const PERCENT = 100;

// Пустая краска пункта это цвет направления, и показать его колодцу нечем: он держит фон
// пульта (`--iron`) и гаснет до пунктира, пока цвет не назначили руками.
const PLAIN_CLASS = 'is-plain';
const PLAIN_INK_VAR = '--iron';

export function createDeck({ root, event, view, actions }) {
  const pick = (hook) => root.querySelector(`[data-js-${hook}]`);
  const plainWell = () => getComputedStyle(root).getPropertyValue(PLAIN_INK_VAR).trim();

  pick('event').textContent = event.event;
  pick('lineup').textContent = event.lineup.join(' / ');

  mountChoice(pick('directions'), DIRECTIONS, view.direction, actions.setDirection);
  mountChoice(
    pick('formats'),
    Object.entries(FORMATS).map(([id, format]) => ({ id, label: format.label })),
    view.format,
    actions.setFormat,
  );
  mountChoice(pick('borders'), BORDERS, view.border, actions.setBorder);
  mountChoice(pick('obj-tones'), OBJ_TONES, view.objTone, actions.setObjTone);
  mountChoice(pick('chaos-zones'), CHAOS_ZONES, view.chaosZone, actions.setChaosZone);

  pick('new-seed').addEventListener('click', actions.newSeed);
  pick('new-lay').addEventListener('click', actions.newLay);
  pick('new-tex').addEventListener('click', actions.newTex);
  pick('new-bg').addEventListener('click', actions.newBg);
  pick('new-obj').addEventListener('click', actions.newObj);
  pick('copy-seed').addEventListener('click', actions.copySeed);
  pick('save-all').addEventListener('click', actions.saveAll);
  pick('allow-3d').addEventListener('click', actions.toggle3d);
  pick('obj-behind').addEventListener('click', actions.toggleObjBehind);
  pick('chaos').addEventListener('click', actions.toggleChaos);

  // Ползунки перерисовывают серию на отпускание, а не на каждый шаг: шесть карточек
  // на шаг движения мыши повесили бы страницу.
  const powerSlider = pick('chaos-power');
  powerSlider.addEventListener('change', () => actions.setChaosPower(Number(powerSlider.value) / PERCENT));
  const alphaSlider = pick('obj-alpha');
  alphaSlider.addEventListener('change', () => actions.setObjAlpha(Number(alphaSlider.value) / PERCENT));
  pick('madness').addEventListener('click', actions.toggleMadness);
  pick('plaque').addEventListener('click', actions.togglePlaque);
  pick('glow').addEventListener('click', actions.toggleGlow);
  pick('sigils').addEventListener('click', actions.toggleSigils);

  // Сид пишется руками: Enter или уход с поля применяют, мусор вернёт прежнее значение.
  const seedField = pick('seed');
  seedField.addEventListener('change', () => actions.setSeed(seedField.value));
  seedField.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) seedField.blur();
  });

  const hotWell = pick('ink-hot');
  const coldWell = pick('ink-cold');
  const applyInks = () => actions.setInks(hotWell.value, coldWell.value);
  hotWell.addEventListener('input', applyInks);
  coldWell.addEventListener('input', applyInks);
  pick('ink-reset').addEventListener('click', actions.resetInks);

  /**
   * Ряд на пункт набора: тумблер, ползунок величины, колодец краски и возврат к
   * направлению. Ряды строятся перебором `TEXT_ROLES`, поэтому названия пунктов живут в
   * одном месте и разметка про них ничего не знает.
   */
  function mountText(holder) {
    return TEXT_ROLES.map((role) => {
      const row = create('div', 'deck__type');

      const toggle = create('button', 'deck__type-show', role.label);
      toggle.type = 'button';
      toggle.title = 'Показать или спрятать пункт';
      toggle.addEventListener('click', () => actions.toggleText(role.id));

      const scale = create('input', 'deck__type-scale');
      scale.type = 'range';
      scale.min = String(SCALE_RANGE.min * PERCENT);
      scale.max = String(SCALE_RANGE.max * PERCENT);
      scale.step = String(SCALE_RANGE.step * PERCENT);
      scale.setAttribute('aria-label', `Величина текста: ${role.label}`);
      scale.addEventListener('change', () => {
        actions.setTextScale(role.id, Number(scale.value) / PERCENT);
      });

      const ink = create('input', 'deck__type-ink');
      ink.type = 'color';
      ink.setAttribute('aria-label', `Цвет текста: ${role.label}`);
      ink.addEventListener('input', () => actions.setTextInk(role.id, ink.value));

      const plain = create('button', 'deck__type-plain', '×');
      plain.type = 'button';
      plain.title = 'Вернуть величину и цвет направления';
      plain.addEventListener('click', () => actions.resetText(role.id));

      row.append(toggle, scale, ink, plain);
      holder.append(row);
      return { role, toggle, scale, ink };
    });
  }

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

  const textRows = mountText(pick('types'));

  return {
    showSeed(seed) {
      seedField.value = seed;
    },
    showState(state) {
      pick('allow-3d').classList.toggle(ACTIVE_CLASS, state.allow3d);
      pick('obj-behind').classList.toggle(ACTIVE_CLASS, state.objBehind);
      powerSlider.value = String(Math.round(state.chaosPower * PERCENT));
      alphaSlider.value = String(Math.round(state.objAlpha * PERCENT));
      pick('chaos').classList.toggle(ACTIVE_CLASS, state.chaos);
      pick('madness').classList.toggle(ACTIVE_CLASS, state.madness);
      pick('plaque').classList.toggle(ACTIVE_CLASS, state.plaque);
      pick('glow').classList.toggle(ACTIVE_CLASS, state.glow);
      pick('sigils').classList.toggle(ACTIVE_CLASS, state.sigils);
      for (const { role, toggle, scale, ink } of textRows) {
        const item = state.text[role.id];
        toggle.classList.toggle(ACTIVE_CLASS, item.on);
        scale.value = String(Math.round(item.scale * PERCENT));
        ink.value = item.ink ?? plainWell();
        ink.classList.toggle(PLAIN_CLASS, item.ink === null);
      }
      // Переброс объёма без включённого 3D рисует вхолостую, кнопка честно гаснет.
      pick('new-obj').disabled = !state.allow3d;
      hotWell.value = state.hot;
      coldWell.value = state.cold;
    },
    note(text) {
      pick('note').textContent = text;
    },
  };
}
