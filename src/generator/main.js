import { ask, cancelRun, runStep, send } from './api.js';
import { createLibrary } from './library.js';
import { createLog } from './log.js';
import { createStage } from './stage.js';

/** Страница генератора: форма, кнопки шагов, живой лог и три превью маршрута. */

const ROUTE = ['image', 'mesh', 'prop'];
const STEP_TITLES = { image: 'картинка', mesh: 'меш', prop: 'проп' };

const fields = {
  prompt: document.querySelector('[data-js-prompt]'),
  preset: document.querySelector('[data-js-preset]'),
  triangles: document.querySelector('[data-js-triangles]'),
  size: document.querySelector('[data-js-size]'),
};
const incoming = document.querySelector('[data-js-incoming]');
const cancelButton = document.querySelector('[data-js-cancel]');
const runButtons = [...document.querySelectorAll('[data-js-run]')];
const takeButton = document.querySelector('[data-js-take]');

const stage = createStage(document.querySelector('.gen-stage'));
const log = createLog(document.querySelector('[data-js-log]'));
const library = createLibrary(document.querySelector('[data-js-library]'), openAsset);

let asset = null;

function params() {
  return {
    asset: asset?.id,
    prompt: fields.prompt.value,
    preset: fields.preset.value,
    triangles: fields.triangles.value || null,
    size: fields.size.value || null,
  };
}

function setBusy(busy) {
  for (const button of [...runButtons, takeButton]) button.disabled = busy;
  cancelButton.hidden = !busy;
}

/** Всякая работа со страницей одна за раз: сервер всё равно держит очередь в один прогон. */
async function execute(work) {
  setBusy(true);
  try {
    await work();
  } catch (error) {
    log.error(error.message);
  } finally {
    setBusy(false);
  }
}

async function step(name) {
  log.title(`Шаг «${STEP_TITLES[name]}»`);
  const result = await runStep(name, params(), (event) => {
    if (event.type === 'log') log.line(event.text, event.at);
  });
  asset = result.asset;
  log.done(`Готово за ${result.seconds} с, пик памяти ${result.peakMegabytes} МБ, `
    + `прогон ${asset.id}`);
  await stage.showStep(name, asset);
  await library.refresh();
}

function openAsset(record) {
  asset = record;
  fields.prompt.value = record.prompt;
  fields.preset.value = record.preset;
  log.title(`Прогон ${record.id} открыт`);
  stage.showAsset(record);
}

for (const button of runButtons) {
  button.addEventListener('click', () => execute(async () => {
    const name = button.dataset.jsRun;
    if (name !== 'all') return step(name);
    // Весь маршрут это новый прогон от промпта: чужие шаги и чужой лог в нём только мешают.
    asset = null;
    log.clear();
    for (const next of ROUTE) await step(next);
  }));
}

cancelButton.addEventListener('click', () => cancelRun());

takeButton.addEventListener('click', () => execute(async () => {
  if (!incoming.value) throw new Error('В _other/incoming нет картинок');
  const result = await send('/import', { ...params(), name: incoming.value });
  asset = result.asset;
  log.title(`Взята готовая картинка ${incoming.value}, прогон ${asset.id}`);
  await stage.showStep('image', asset);
  await library.refresh();
}));

execute(async () => {
  const { images } = await ask('/incoming');
  incoming.replaceChildren(...images.map((name) => new Option(name, name)));
  await library.refresh();
});
