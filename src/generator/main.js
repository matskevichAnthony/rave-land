import { ask, cancelRun, runStep, send, upload } from './api.js';
import { createLibrary } from './library.js';
import { createLog } from './log.js';
import { createOwnImage, toPng } from './own-image.js';
import { createStage } from './stage.js';
import { createSteps } from './steps.js';

/** Страница генератора: три шага маршрута по отдельности, живой лог и состояние прогона. */

const fields = {
  prompt: document.querySelector('[data-js-prompt]'),
  preset: document.querySelector('[data-js-preset]'),
  triangles: document.querySelector('[data-js-triangles]'),
  size: document.querySelector('[data-js-size]'),
};
const incoming = document.querySelector('[data-js-incoming]');
const latinWarning = document.querySelector('[data-js-latin]');
const cancelButton = document.querySelector('[data-js-cancel]');
const allButton = document.querySelector('[data-js-all]');
const newButton = document.querySelector('[data-js-new]');
const takeButton = document.querySelector('[data-js-take]');
const runId = document.querySelector('[data-js-run-id]');
const runDone = document.querySelector('[data-js-run-done]');

const stepsRoot = document.querySelector('[data-js-steps]');
const stage = createStage(stepsRoot);
const log = createLog(document.querySelector('[data-js-log]'));
const library = createLibrary(document.querySelector('[data-js-library]'), openAsset);
const steps = createSteps(stepsRoot, (name) => execute(() => runOne(name)));
const ownImage = createOwnImage(document.querySelector('[data-js-drop]'), (file) => execute(async () => {
  const png = await toPng(file);
  const { asset } = await upload(png, { name: file.name, preset: fields.preset.value });
  await useImage(asset, `Своя картинка ${file.name}`);
}));

const state = { steps: [], asset: null, busy: false, running: null };

const stepTitle = (name) => state.steps.find((step) => step.name === name).title;

function doneWords() {
  if (!state.asset) return 'новый: его создаст первый же шаг';
  const done = state.steps.filter((step) => state.asset.files[step.name]);
  return done.length
    ? `сделано: ${done.map((step) => step.title.toLowerCase()).join(', ')}`
    : 'папка пока пустая';
}

function show() {
  steps.show(state);
  runId.textContent = state.asset?.id ?? 'ещё нет';
  runDone.textContent = doneWords();
  cancelButton.hidden = !state.busy;
  for (const button of [allButton, newButton, takeButton]) button.disabled = state.busy;
  ownImage.setBusy(state.busy);
}

function setAsset(asset) {
  state.asset = asset;
  show();
}

function params() {
  return {
    asset: state.asset?.id,
    prompt: fields.prompt.value,
    preset: fields.preset.value,
    triangles: fields.triangles.value || null,
    size: fields.size.value || null,
  };
}

// Текстовый кодировщик модели знает только латиницу: кириллица уходит в него неизвестными
// словами, и вместо мешков с песком приезжает случайная картинка. Предупредить дешевле, чем
// объяснять потом четыре минуты ожидания впустую.
fields.prompt.addEventListener('input', () => {
  latinWarning.hidden = !/[А-Яа-яЁё]/.test(fields.prompt.value);
});

/** Всякая работа со страницей одна за раз: сервер всё равно держит очередь в один прогон. */
async function execute(work) {
  state.busy = true;
  show();
  try {
    await work();
  } catch (error) {
    log.error(error.message);
  } finally {
    state.busy = false;
    state.running = null;
    show();
  }
}

async function runOne(name) {
  state.running = name;
  show();
  log.title(`Шаг «${stepTitle(name)}»`);
  const result = await runStep(name, params(), (event) => {
    if (event.type === 'log') log.line(event.text, event.at);
  });
  state.running = null;
  setAsset(result.asset);
  log.done(`Готово за ${result.seconds} с, пик памяти ${result.peakMegabytes} МБ, `
    + `прогон ${result.asset.id}`);
  await stage.showStep(name, result.asset);
  await library.refresh();
}

/** Принесённая картинка встаёт на место первого шага и открывает свой прогон. */
async function useImage(asset, source) {
  setAsset(asset);
  log.title(`${source}: прогон ${asset.id}`);
  await stage.showStep('image', asset);
  await library.refresh();
}

function openAsset(asset) {
  fields.prompt.value = asset.prompt;
  fields.preset.value = asset.preset;
  setAsset(asset);
  log.title(`Прогон ${asset.id} открыт`);
  stage.showAsset(asset);
}

allButton.addEventListener('click', () => execute(async () => {
  // Весь маршрут это новый прогон от промпта: чужие шаги и чужой лог в нём только мешают.
  state.asset = null;
  log.clear();
  for (const step of state.steps) await runOne(step.name);
}));

newButton.addEventListener('click', () => {
  state.asset = null;
  stage.clear();
  log.title('Прогон закрыт: следующий шаг заведёт новый');
  show();
});

cancelButton.addEventListener('click', () => cancelRun());

takeButton.addEventListener('click', () => execute(async () => {
  if (!incoming.value) throw new Error('В _other/incoming нет картинок');
  const { asset } = await send('/import', { name: incoming.value, preset: fields.preset.value });
  await useImage(asset, `Готовая картинка ${incoming.value}`);
}));

execute(async () => {
  state.steps = (await ask('/steps')).steps;
  const { images } = await ask('/incoming');
  incoming.replaceChildren(...images.map((name) => new Option(name, name)));
  await library.refresh();
});
