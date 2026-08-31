import { create } from '../ui/dom.js';
import { CAMERA_SPOT_EVENT } from './camera.js';

/**
 * Пульт съёмки: сид, кадр, ручки постобработки и замер.
 *
 * Ручки строятся перебором словаря `controls` постобработки, поэтому пульт ничего не знает
 * про её внутренности: добавили эффект, ползунок появился сам.
 */

const STAT_ROWS = [
  { key: 'fps', label: 'Кадров в секунду' },
  { key: 'worst', label: 'Худший кадр, мс' },
  { key: 'calls', label: 'Вызовов отрисовки' },
  { key: 'triangles', label: 'Треугольников' },
];

const KNOB_DEFAULTS = { min: 0, max: 1, step: 0.01 };
const DEFAULT_TAKE_SECONDS = 8;
const MAX_TAKE_SECONDS = 60;
const HIDDEN_CLASS = 'deck--hidden';
const TOGGLE_LABEL = { shown: 'Скрыть', hidden: 'Пульт' };
const LOCKED_WHILE_RECORDING = '[data-js-framing], [data-js-new-seed], [data-js-quality]';
const OVER_CLASS = 'meter__value--over';

const formatValue = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const meters = (value) => `${value.toFixed(1)} м`;
const datasetKey = (hook) => `js${hook[0].toUpperCase()}${hook.slice(1)}`;

export function createPanel({
  root,
  opener,
  event,
  budget,
  controls,
  view,
  actions,
  // Своя камера у каждой сцены, а пульт один: имя события приходит от того рига, чей
  // кадр показан. По умолчанию это риг UNDERSTAV, и его вызов остаётся прежним.
  spotEvent = CAMERA_SPOT_EVENT,
}) {
  const pick = (hook) => root.querySelector(`[data-js-${hook}]`);

  pick('event').textContent = event.event;
  pick('tagline').textContent = event.tagline ?? '';
  pick('date').textContent = event.dateLabel ?? event.date;
  pick('lineup').textContent = event.lineup.join(' / ');

  const spot = pick('spot');
  // Найденный руками кадр повторяют по трём числам, поэтому в свободном режиме пульт
  // показывает, где стоит камера.
  window.addEventListener(spotEvent, (domEvent) => showSpot(domEvent.detail));

  const stats = mountStats(pick('stats'));
  const knobs = mountKnobs(pick('knobs'), controls);
  wireChoice('mode', view.mode, actions.setMode);
  wireChoice('framing', view.framing, actions.setFraming);
  // Разрешение дубля есть не у всякой сцены: пульт один на все, и о чём вид не сказал,
  // того он не вешает.
  if (view.quality) wireChoice('quality', view.quality, actions.setQuality);

  opener.addEventListener('click', toggleDeck);
  pick('new-seed').addEventListener('click', actions.newSeed);
  pick('copy-seed').addEventListener('click', actions.copySeed);
  // Галочку ставит вид, а не разметка: иначе состояние отсчёта живёт в двух местах и разъезжается.
  const countdown = pick('countdown');
  countdown.checked = view.countdown;
  countdown.addEventListener('change', () => actions.setCountdown(countdown.checked));
  // Афиша и выгрузка есть не у всякой сцены, а пульт один на все: чего разметка не объявила,
  // того пульт и не вешает. Иначе соседняя страница валится на первом же чужом хуке.
  const poster = pick('poster');
  if (poster) {
    poster.checked = view.poster;
    poster.addEventListener('change', () => actions.setPoster(poster.checked));
  }
  const print = pick('print');
  if (print) {
    print.checked = view.print;
    print.addEventListener('change', () => actions.setPrint(print.checked));
  }
  const flat = pick('flat');
  if (flat) {
    flat.checked = view.flat;
    flat.addEventListener('change', () => actions.setFlat(flat.checked));
  }
  // Угол объектива есть не у всякой страницы с пультом, поэтому спрашивается, а не берётся.
  const fov = pick('fov');
  if (fov) {
    fov.value = String(view.fov);
    showFov(view.fov);
    fov.addEventListener('input', () => {
      const degrees = Number(fov.value);
      showFov(degrees);
      actions.setFov(degrees);
    });
  }

  function showFov(degrees) {
    pick('fov-value').textContent = String(Math.round(degrees));
  }
  pick('shoot').addEventListener('click', () => actions.shoot(takeSeconds()));
  pick('capture').addEventListener('click', actions.capture);
  // Фото есть не у всякой сцены: у пульта один код на все, и лишний хук он не требует.
  pick('photo')?.addEventListener('click', actions.photo);
  // Формат уходит с самой кнопки: их у выгрузки столько же, сколько форматов в разметке.
  for (const button of root.querySelectorAll('[data-js-save-scene]')) {
    button.addEventListener('click', () => actions.saveScene(button.dataset.jsSaveScene));
  }
  pick('guest').addEventListener('click', actions.guest);
  pick('battle').addEventListener('click', actions.battle);

  function setDeck(hidden) {
    root.classList.toggle(HIDDEN_CLASS, hidden);
    opener.textContent = hidden ? TOGGLE_LABEL.hidden : TOGGLE_LABEL.shown;
    opener.setAttribute('aria-expanded', String(!hidden));
  }

  function toggleDeck() {
    setDeck(!root.classList.contains(HIDDEN_CLASS));
  }

  function showSpot(place) {
    spot.hidden = !place;
    if (!place) return;
    spot.textContent = `X ${meters(place.x)} Y ${meters(place.y)} Z ${meters(place.z)}`;
  }

  function wireChoice(hook, current, apply) {
    const key = datasetKey(hook);
    const buttons = [...root.querySelectorAll(`[data-js-${hook}]`)];
    const mark = (value) => {
      for (const button of buttons) button.classList.toggle('is-active', button.dataset[key] === value);
    };
    for (const button of buttons) {
      button.addEventListener('click', () => {
        mark(button.dataset[key]);
        apply(button.dataset[key]);
      });
    }
    mark(current);
  }

  function takeSeconds() {
    const asked = Number(pick('duration').value);
    if (!Number.isFinite(asked) || asked <= 0) return DEFAULT_TAKE_SECONDS;
    return Math.min(asked, MAX_TAKE_SECONDS);
  }

  return {
    showSeed(seed) {
      pick('seed').textContent = seed;
    },
    showDays(days) {
      pick('days').textContent = days;
    },
    showStats(measured) {
      stats.fps.textContent = Math.round(measured.fps);
      stats.worst.textContent = measured.worstMs.toFixed(1);
      stats.calls.textContent = measured.calls;
      stats.triangles.textContent = measured.triangles.toLocaleString('ru-RU');
      stats.fps.classList.toggle(OVER_CLASS, measured.fps < budget.targetFps);
      stats.worst.classList.toggle(OVER_CLASS, measured.worstMs > 1000 / budget.targetFps);
      stats.calls.classList.toggle(OVER_CLASS, measured.calls > budget.drawCalls);
      stats.triangles.classList.toggle(OVER_CLASS, measured.triangles > budget.triangles);
    },
    note(text) {
      pick('note').textContent = text;
    },
    // Ручки крутит не только рука: печатный вид ставит свои значения, и ползунки обязаны
    // показать, что стоит на самом деле.
    showKnobs() {
      knobs.sync();
    },
    setRecording(active) {
      const button = pick('shoot');
      button.classList.toggle('is-recording', active);
      button.textContent = active ? 'Пишу' : 'Снять';
      pick('capture').disabled = active;
      const photo = pick('photo');
      if (photo) photo.disabled = active;
      // Смена кадрирования и сида посреди дубля меняет размер холста, а дорожка записи
      // этого не переживает, поэтому на время записи кнопки закрыты.
      for (const locked of root.querySelectorAll(LOCKED_WHILE_RECORDING)) locked.disabled = active;
    },
    setExporting(active) {
      // Вторая выгрузка поверх первой снимала бы слепок с той же сцены ещё раз, а обе
      // держат в памяти по копии всего зала, поэтому на время сборки закрыты все форматы.
      for (const button of root.querySelectorAll('[data-js-save-scene]')) {
        button.disabled = active;
      }
    },
    toggle: toggleDeck,
    hide: () => setDeck(true),
  };
}

function mountStats(box) {
  const cells = {};
  for (const row of STAT_ROWS) {
    const value = create('dd', 'meter__value', '0');
    cells[row.key] = value;
    box.append(create('dt', 'meter__name', row.label), value);
  }
  return cells;
}

function mountKnobs(box, controls) {
  const entries = Object.entries(controls ?? {});
  if (!entries.length) {
    box.append(create('p', 'deck__hint', 'У постобработки нет ручек.'));
    return { sync: () => {} };
  }
  const syncs = [];
  box.append(...entries.map(([name, control]) => renderKnob(name, control, syncs)));
  return { sync: () => syncs.forEach((update) => update()) };
}

function renderKnob(name, control, syncs) {
  const knob = create('label', 'knob');
  knob.append(create('span', 'knob__name', control.label ?? name));
  const value = control.get();
  if (typeof value === 'boolean') {
    knob.append(renderSwitch(control, value, syncs));
    return knob;
  }
  const readout = create('b', 'knob__value', formatValue(value));
  knob.append(readout, renderSlider(control, value, readout, syncs));
  return knob;
}

function renderSwitch(control, value, syncs) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'knob__switch';
  input.checked = value;
  input.addEventListener('change', () => control.set(input.checked));
  syncs.push(() => {
    input.checked = control.get();
  });
  return input;
}

function renderSlider(control, value, readout, syncs) {
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'knob__slider';
  input.min = control.min ?? KNOB_DEFAULTS.min;
  input.max = control.max ?? KNOB_DEFAULTS.max;
  input.step = control.step ?? KNOB_DEFAULTS.step;
  input.value = value;
  input.addEventListener('input', () => {
    const next = Number(input.value);
    control.set(next);
    readout.textContent = formatValue(next);
  });
  syncs.push(() => {
    input.value = control.get();
    readout.textContent = formatValue(control.get());
  });
  return input;
}
