/**
 * Витрина серии: все шесть афиш на одной странице.
 *
 * Карточка проверяется только рядом с соседями: по одной они все выглядят убедительно, а
 * серией расходятся по кеглю имени и высоте подписи. Поэтому лист рисует сразу шесть и
 * перерисовывает их целиком: половина листа от старого сида, половина от нового врёт сильнее,
 * чем полное отсутствие предпросмотра.
 */

import { artistCards } from './event.js';
import { renderCard } from './render.js';
import { downloadCanvas } from './download.js';

const SAVE_HOOK = 'data-js-save-card';

function createSheet(artist) {
  const sheet = document.createElement('figure');
  sheet.className = 'sheet';
  const caption = document.createElement('figcaption');
  caption.className = 'sheet__caption';
  caption.textContent = `${artist.number} · ${artist.name}`;
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'sheet__save';
  save.textContent = 'Скачать';
  save.setAttribute(SAVE_HOOK, artist.number);
  sheet.append(caption, save);
  return sheet;
}

export function createGallery({ root, event, logo, note }) {
  const artists = artistCards(event);
  const sheets = artists.map(createSheet);
  const canvases = new Map();
  root.append(...sheets);

  root.addEventListener('click', (click) => {
    const button = click.target.closest(`[${SAVE_HOOK}]`);
    if (!button) return;
    const number = button.getAttribute(SAVE_HOOK);
    downloadCanvas(canvases.get(number).canvas, canvases.get(number).name);
  });

  function draw(view) {
    for (const [index, artist] of artists.entries()) {
      const canvas = renderCard({ ...view, event, artist, logo, index });
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
