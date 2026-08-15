import { collectPlaceable } from '../models/inventory.js';
import { createThumbnails } from '../models/thumbnails.js';
import { loadModel } from '../objects/gltf.js';
import { create } from '../ui/dom.js';

/**
 * Каталог мастерской в панели редактора: клик по карточке ставит предмет в мир.
 *
 * Каталог собирается на первом открытии редактора, а не при загрузке мира: до Tab
 * он стоил бы второго контекста WebGL и загрузки всех моделей тому, кто просто гуляет.
 * Превью прогонов генератора это готовый кадр с диска, а пропам его рисует общий
 * рендерер превью, и модель для него берётся из кэша мира: тот же файл потом встаёт
 * в сцену уже загруженным.
 */
export function createWorkshop({ root, spawnModel }) {
  let opened = false;
  let thumbnails = null;

  function open() {
    if (opened) return;
    opened = true;
    collectPlaceable().then(render).catch(showError);
  }

  function render(groups) {
    if (!groups.length) {
      root.replaceChildren(create('p', 'panel__hint', 'В мастерской пока нет готовых моделей.'));
      return;
    }
    const previews = [];
    root.replaceChildren(...groups.flatMap((group) => [
      create('h4', 'workshop__group', group.title),
      renderGrid(group.items, previews),
    ]));
    // Рендерер превью заводится только под первую карточку без готового кадра.
    if (previews.length) thumbnails ??= createThumbnails({ shared: true });
    for (const { canvas, card, item } of previews) {
      thumbnails.add(canvas, () => loadModel(item.src)).catch((error) => {
        canvas.remove();
        card.prepend(create('span', 'workshop__failed', `Превью не собралось: ${error.message}`));
      });
    }
  }

  function renderGrid(items, previews) {
    const grid = create('div', 'workshop__grid');
    grid.append(...items.map((item) => renderCard(item, previews)));
    return grid;
  }

  function renderCard(item, previews) {
    const card = create('button', 'workshop__item');
    card.append(
      renderPreview(item, card, previews),
      create('span', 'workshop__name', item.title),
      create('small', 'workshop__facts', item.facts),
    );
    card.addEventListener('click', () => spawnModel(item.src));
    return card;
  }

  function renderPreview(item, card, previews) {
    if (item.preview) {
      const image = create('img', 'workshop__preview');
      image.src = item.preview;
      image.loading = 'lazy';
      image.alt = item.title;
      return image;
    }
    const canvas = create('canvas', 'workshop__preview');
    previews.push({ canvas, card, item });
    return canvas;
  }

  function showError(error) {
    root.replaceChildren(create('p', 'panel__hint', `Опись мастерской не прочиталась: ${error.message}`));
  }

  return { open };
}
