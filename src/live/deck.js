/**
 * Пульт живого выхода: источник, слух, машина, разложение, картинка, разгром, цвет, вывод.
 *
 * Ряды кнопок строятся перебором словарей: добавили источник в движок PX или приём в
 * `mangle.js`, и кнопка появилась сама. Состояния пульт не держит: правда живёт в `view`
 * страницы, пульт только показывает её через `showState`, поэтому кнопка не может
 * разъехаться с картинкой.
 *
 * Ползунки здесь слушают `input`, а не `change`, в отличие от пульта афиш: там движение
 * ползунка перерисовывало шесть тяжёлых карточек, здесь оно меняет число, которое и так
 * читается на следующем кадре. Исключение одно и оно важное: ползунки, которые заставляют
 * машину считать кадр заново, слушают `change`. Источник PX считается от десятков
 * миллисекунд до секунды, и пересчёт на каждый пиксель хода ползунка вешает страницу.
 */

import { create } from '../ui/dom.js';
import { WILDNESS } from '../px/paint.js';
import { BLENDS } from '../procedural/blend.js';
import { MACHINE_OPS, MACHINE_PALETTES, MACHINE_SOURCES } from './machine.js';
import { MANGLES } from './mangle.js';
import { OVERLAY_PLACES } from './overlay.js';
import { SOURCES } from './source.js';

const ACTIVE_CLASS = 'is-active';
const PERCENT = 100;

// Мутация в ударах: ноль это «не менять никогда», дальше от такта до целого куска трека.
const MUTATE_STEPS = [0, 1, 2, 4, 8, 16, 32, 64];

const EARS = [
  { id: 'microphone', label: 'Микрофон' },
  { id: 'source', label: 'Звук источника' },
  { id: 'off', label: 'Тишина' },
];

export function createDeck({ root, view, actions }) {
  const pick = (hook) => root.querySelector(`[data-js-${hook}]`);

  const sourceButtons = mountChoice(pick('sources'), SOURCES, actions.setSource);
  const earButtons = mountChoice(pick('ears'), EARS, actions.setEar);
  const machineButtons = mountChoice(pick('machines'), MACHINE_SOURCES, actions.setMachineSource, wildTitle);
  const paletteButtons = mountChoice(pick('palettes'), MACHINE_PALETTES, actions.setPalette);
  const opButtons = mountChoice(pick('ops'), MACHINE_OPS, actions.setOp, (op) => op.desc);
  const blendButtons = mountChoice(pick('blends'), BLENDS, actions.setMachineBlend);
  const placeButtons = mountChoice(pick('overlay-places'), OVERLAY_PLACES, actions.setOverlayPlace);
  const overlayBlendButtons = mountChoice(pick('overlay-blends'), BLENDS, actions.setOverlayBlend);
  const mangleButtons = mountChoice(pick('mangles'), MANGLES, actions.toggleMangle);

  const sliders = {
    quiet: mountSlider(pick('quiet'), actions.setQuiet),
    loud: mountSlider(pick('loud'), actions.setLoud),
    punch: mountSlider(pick('punch'), actions.setPunch),
    pace: mountSlider(pick('pace'), actions.setPace),
    spread: mountSlider(pick('spread'), actions.setSpread, 'change'),
    wreck: mountSlider(pick('wreck'), actions.setWreck, 'change'),
    strength: mountSlider(pick('strength'), actions.setStrength),
    feed: mountSlider(pick('feed'), actions.setFeed),
    alpha: mountSlider(pick('alpha'), actions.setAlpha),
    overlayScale: mountSlider(pick('overlay-scale'), actions.setOverlayScale),
    overlayAlpha: mountSlider(pick('overlay-alpha'), actions.setOverlayAlpha),
    power: mountSlider(pick('power'), actions.setPower),
    density: mountSlider(pick('density'), actions.setDensity),
  };

  const mutateField = pick('mutate');
  mutateField.max = String(MUTATE_STEPS.length - 1);
  mutateField.addEventListener('input', () => actions.setMutate(MUTATE_STEPS[Number(mutateField.value)]));

  const fileField = pick('file');
  fileField.addEventListener('change', () => {
    if (fileField.files[0]) actions.openFile(fileField.files[0]);
  });

  const urlField = pick('url');
  urlField.addEventListener('change', () => actions.openUrl(urlField.value.trim()));

  const overlayFile = pick('overlay-file');
  overlayFile.addEventListener('change', () => {
    if (overlayFile.files[0]) actions.openOverlay(overlayFile.files[0]);
  });
  pick('overlay-pick').addEventListener('click', actions.pickOverlay);
  pick('overlay-drop').addEventListener('click', () => {
    overlayFile.value = '';
    actions.dropOverlay();
  });
  pick('overlay-tint').addEventListener('click', actions.toggleOverlayTint);

  const hotWell = pick('ink-hot');
  const coldWell = pick('ink-cold');
  const applyInks = () => actions.setInks(hotWell.value, coldWell.value);
  hotWell.addEventListener('input', applyInks);
  coldWell.addEventListener('input', applyInks);

  pick('auto').addEventListener('click', actions.toggleAuto);
  pick('roll').addEventListener('click', actions.roll);
  pick('video').addEventListener('click', actions.toggleVideo);
  pick('freeze').addEventListener('click', actions.toggleFreeze);
  pick('full').addEventListener('click', actions.goFullscreen);

  const meterBar = pick('meter-bar');
  const meterRaw = pick('meter-raw');
  const meterQuiet = pick('meter-quiet');
  const meterLoud = pick('meter-loud');
  const meterPunch = pick('meter-punch');
  const machineDesc = pick('machine-desc');
  const opDesc = pick('op-desc');
  const mutateDesc = pick('mutate-desc');
  const note = pick('note');
  const rate = pick('rate');

  function wildTitle(source) {
    return `${WILDNESS[source.wild].note}\n\n${source.desc}`;
  }

  function mountChoice(holder, options, apply, title = null) {
    return options.map((option) => {
      const mark = option.wild ? `${WILDNESS[option.wild].mark} ` : '';
      const button = create('button', '', `${mark}${option.label}`);
      button.type = 'button';
      if (title) button.title = title(option);
      button.addEventListener('click', () => apply(option.id));
      holder.append(button);
      return { id: option.id, button };
    });
  }

  function mountSlider(input, apply, event = 'input') {
    input.addEventListener(event, () => apply(Number(input.value) / PERCENT));
    return input;
  }

  function light(buttons, isOn) {
    for (const { id, button } of buttons) button.classList.toggle(ACTIVE_CLASS, isOn(id));
  }

  const percent = (input, value) => { input.value = String(Math.round(value * PERCENT)); };

  return {
    showState(state) {
      const set = state.machine;
      light(sourceButtons, (id) => id === state.source);
      light(earButtons, (id) => id === state.ear);
      light(machineButtons, (id) => id === set.source);
      light(paletteButtons, (id) => id === set.palette);
      light(opButtons, (id) => id === set.op);
      light(blendButtons, (id) => id === set.blend);
      light(placeButtons, (id) => id === state.overlay.place);
      light(overlayBlendButtons, (id) => id === state.overlay.blend);
      light(mangleButtons, (id) => state.mangles.has(id));

      percent(sliders.quiet, state.quiet);
      percent(sliders.loud, state.loud);
      percent(sliders.punch, state.punch);
      percent(sliders.pace, state.pace);
      pick('auto').classList.toggle(ACTIVE_CLASS, state.auto);
      percent(sliders.spread, set.spread);
      percent(sliders.wreck, set.wreck);
      percent(sliders.strength, set.strength);
      percent(sliders.feed, set.feed);
      percent(sliders.alpha, set.alpha);
      percent(sliders.overlayScale, state.overlay.scale);
      percent(sliders.overlayAlpha, state.overlay.alpha);
      percent(sliders.power, state.power);
      percent(sliders.density, state.density);
      mutateField.value = String(Math.max(0, MUTATE_STEPS.indexOf(set.mutate)));
      mutateDesc.textContent = set.mutate
        ? `бросок каждые ${set.mutate} удар${ending(set.mutate)}`
        : 'машина стоит, пока её не бросят рукой';

      const source = MACHINE_SOURCES.find(({ id }) => id === set.source);
      machineDesc.textContent = `${WILDNESS[source.wild].mark} ${source.desc}`;
      opDesc.textContent = MACHINE_OPS.find(({ id }) => id === set.op).desc;

      hotWell.value = state.hot;
      coldWell.value = state.cold;
      pick('overlay-tint').classList.toggle(ACTIVE_CLASS, state.overlay.tint);
      pick('video').classList.toggle(ACTIVE_CLASS, state.showVideo);
      pick('freeze').classList.toggle(ACTIVE_CLASS, state.freeze);
    },
    /**
     * Полоски уровня и счётчик кадров: единственное, что пульт рисует каждый кадр.
     *
     * Полосок две, и вторая тут не для красоты. Верхняя показывает то, что уходит в
     * картинку, нижняя сырой звук как он есть, с метками трёх ползунков поверх. Ставить
     * шкалу руками, не видя сырого звука, значит крутить ползунок вслепую и гадать, почему
     * картинка молчит.
     */
    showPulse({ level, raw, hit, scale, fps }) {
      meterBar.style.width = `${Math.round(level * PERCENT)}%`;
      meterBar.classList.toggle('is-hit', hit);
      meterRaw.style.width = `${Math.round(raw * PERCENT)}%`;
      // Метки едут вместе с ползунком, а не с перерисовкой пульта: их и тянут рукой,
      // глядя на сырую полоску, поэтому отставание на кадр здесь недопустимо.
      meterQuiet.style.left = `${scale.quiet * PERCENT}%`;
      meterLoud.style.left = `${scale.loud * PERCENT}%`;
      meterPunch.style.left = `${scale.punch * PERCENT}%`;
      rate.textContent = `${fps} кадр/с`;
    },
    note(text) {
      note.textContent = text;
    },
  };
}

const ending = (beats) => (beats === 1 ? '' : beats < 5 ? 'а' : 'ов');
