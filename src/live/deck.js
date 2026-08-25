/**
 * Пульт живого выхода: источник, слух, поле, разгром, цвет и вывод.
 *
 * Ряды кнопок строятся перебором словарей источников, полей, наложений и приёмов: добавили
 * приём в `mangle.js`, и кнопка появилась сама. Состояния пульт не держит: правда живёт в
 * `view` страницы, пульт только показывает её через `showState`, поэтому кнопка не может
 * разъехаться с картинкой.
 *
 * Ползунки здесь слушают `input`, а не `change`, в отличие от пульта афиш: там движение
 * ползунка перерисовывало шесть тяжёлых карточек, здесь оно меняет число, которое и так
 * читается на следующем кадре.
 */

import { create } from '../ui/dom.js';
import { BLENDS } from './blend.js';
import { FIELDS } from './field.js';
import { MANGLES } from './mangle.js';
import { SOURCES } from './source.js';

const ACTIVE_CLASS = 'is-active';
const PERCENT = 100;

const EARS = [
  { id: 'microphone', label: 'Микрофон' },
  { id: 'source', label: 'Звук источника' },
  { id: 'off', label: 'Тишина' },
];

export function createDeck({ root, view, actions }) {
  const pick = (hook) => root.querySelector(`[data-js-${hook}]`);

  const sourceButtons = mountChoice(pick('sources'), SOURCES, actions.setSource);
  const earButtons = mountChoice(pick('ears'), EARS, actions.setEar);
  const fieldButtons = mountChoice(pick('fields'), FIELDS, actions.setField);
  const blendButtons = mountChoice(pick('blends'), BLENDS, actions.setBlend);
  const mangleButtons = mountChoice(pick('mangles'), MANGLES, actions.toggleMangle);

  const sliders = {
    threshold: mountSlider(pick('threshold'), actions.setThreshold),
    alpha: mountSlider(pick('alpha'), actions.setAlpha),
    speed: mountSlider(pick('speed'), actions.setSpeed),
    power: mountSlider(pick('power'), actions.setPower),
    density: mountSlider(pick('density'), actions.setDensity),
  };

  const fileField = pick('file');
  fileField.addEventListener('change', () => {
    if (fileField.files[0]) actions.openFile(fileField.files[0]);
  });

  const urlField = pick('url');
  urlField.addEventListener('change', () => actions.openUrl(urlField.value.trim()));

  const hotWell = pick('ink-hot');
  const coldWell = pick('ink-cold');
  const applyInks = () => actions.setInks(hotWell.value, coldWell.value);
  hotWell.addEventListener('input', applyInks);
  coldWell.addEventListener('input', applyInks);

  pick('video').addEventListener('click', actions.toggleVideo);
  pick('freeze').addEventListener('click', actions.toggleFreeze);
  pick('full').addEventListener('click', actions.goFullscreen);

  const meterBar = pick('meter-bar');
  const note = pick('note');
  const rate = pick('rate');

  function mountChoice(holder, options, apply) {
    return options.map((option) => {
      const button = create('button', '', option.label);
      button.type = 'button';
      button.addEventListener('click', () => apply(option.id));
      holder.append(button);
      return { id: option.id, button };
    });
  }

  function mountSlider(input, apply) {
    input.addEventListener('input', () => apply(Number(input.value) / PERCENT));
    return input;
  }

  function light(buttons, isOn) {
    for (const { id, button } of buttons) button.classList.toggle(ACTIVE_CLASS, isOn(id));
  }

  return {
    showState(state) {
      light(sourceButtons, (id) => id === state.source);
      light(earButtons, (id) => id === state.ear);
      light(fieldButtons, (id) => id === state.field);
      light(blendButtons, (id) => id === state.blend);
      light(mangleButtons, (id) => state.mangles.has(id));
      sliders.threshold.value = String(Math.round(state.threshold * PERCENT));
      sliders.alpha.value = String(Math.round(state.alpha * PERCENT));
      sliders.speed.value = String(Math.round(state.speed * PERCENT));
      sliders.power.value = String(Math.round(state.power * PERCENT));
      sliders.density.value = String(Math.round(state.density * PERCENT));
      hotWell.value = state.hot;
      coldWell.value = state.cold;
      pick('video').classList.toggle(ACTIVE_CLASS, state.showVideo);
      pick('freeze').classList.toggle(ACTIVE_CLASS, state.freeze);
    },
    /** Полоска уровня и счётчик кадров: единственное, что пульт рисует каждый кадр. */
    showPulse({ level, hit, fps }) {
      meterBar.style.width = `${Math.round(level * PERCENT)}%`;
      meterBar.classList.toggle('is-hit', hit);
      rate.textContent = `${fps} кадр/с`;
    },
    note(text) {
      note.textContent = text;
    },
  };
}
