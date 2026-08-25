/**
 * Витрина серии: все шесть афиш на одной странице.
 *
 * Карточка проверяется только рядом с соседями: по одной они все выглядят убедительно, а
 * серией расходятся по кеглю имени и высоте подписи. Поэтому лист рисует сразу шесть и
 * перерисовывает их целиком: половина листа от старого сида, половина от нового врёт сильнее,
 * чем полное отсутствие предпросмотра.
 *
 * Текстовый слой не хранится: он рендерится заново в момент нажатия из последнего вида.
 * Хранить второй холст на карточку значило бы удвоить память листа ради кнопки, которую
 * жмут раз на серию.
 */

import { artistCards } from './event.js';
import { renderCard } from './render.js';
import { downloadCanvas } from './download.js';

const SAVE_HOOK = 'data-js-save-card';
const TEXT_HOOK = 'data-js-save-text';
const ROLL_HOOK = 'data-js-reroll-card';

function createSheet(artist, index) {
  const sheet = document.createElement('figure');
  sheet.className = 'sheet';
  const caption = document.createElement('figcaption');
  caption.className = 'sheet__caption';
  caption.textContent = `${artist.number} · ${artist.name}`;
  const row = document.createElement('div');
  row.className = 'sheet__row';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'sheet__save';
  save.textContent = 'Скачать';
  save.setAttribute(SAVE_HOOK, artist.number);
  const text = document.createElement('button');
  text.type = 'button';
  text.className = 'sheet__save';
  text.textContent = 'Текст';
  text.setAttribute(TEXT_HOOK, artist.number);
  const roll = document.createElement('button');
  roll.type = 'button';
  roll.className = 'sheet__save';
  roll.textContent = 'Заново';
  roll.title = 'Переродить только эту карточку: остальная серия не шевелится';
  roll.setAttribute(ROLL_HOOK, String(index));
  row.append(save, text, roll);
  sheet.append(caption, row);
  return sheet;
}

export function createGallery({ root, event, logo, note, reroll }) {
  const artists = artistCards(event);
  const sheets = artists.map(createSheet);
  const canvases = new Map();
  let lastView = null;
  root.append(...sheets);

  root.addEventListener('click', (click) => {
    const saver = click.target.closest(`[${SAVE_HOOK}]`);
    if (saver) {
      const held = canvases.get(saver.getAttribute(SAVE_HOOK));
      downloadCanvas(held.canvas, held.name);
      return;
    }
    const roller = click.target.closest(`[${ROLL_HOOK}]`);
    if (roller) {
      reroll(Number(roller.getAttribute(ROLL_HOOK)));
      return;
    }
    const texter = click.target.closest(`[${TEXT_HOOK}]`);
    if (!texter) return;
    const number = texter.getAttribute(TEXT_HOOK);
    const index = artists.findIndex((artist) => artist.number === number);
    const layer = renderCard({
      ...lastView,
      localSeed: lastView.cardSeeds?.[index] ?? null,
      event, artist: artists[index], logo, index, textOnly: true,
    });
    downloadCanvas(layer, `${canvases.get(number).name}-text`);
  });

  function draw(view) {
    lastView = { ...view };
    for (const [index, artist] of artists.entries()) {
      const canvas = renderCard({
        ...view, localSeed: view.cardSeeds?.[index] ?? null, event, artist, logo, index,
      });
      canvas.className = 'sheet__card';
      canvases.set(artist.number, {
        canvas,
        name: `understav-${view.direction}-${artist.number}-${view.seed}`,
      });
      sheets[index].querySelector('.sheet__card')?.remove();
      sheets[index].prepend(canvas);
    }
    note(`Направление «${view.direction}», сид ${view.seed}`);
  }

  async function saveAll() {
    for (const artist of artists) {
      const sheet = canvases.get(artist.number);
      await downloadCanvas(sheet.canvas, sheet.name);
    }
    note(`Сохранено карточек: ${artists.length}`);
  }

  return { draw, saveAll };
}
