import { ask } from './api.js';

/** Список прошлых прогонов из описи генератора: страница своего списка не держит. */

const STEP_TITLES = { image: 'картинка', mesh: 'меш', prop: 'проп' };

function ready(asset) {
  const done = Object.keys(STEP_TITLES).filter((step) => asset.files[step]);
  return done.length ? done.map((step) => STEP_TITLES[step]).join(', ') : 'пусто';
}

function createCard(asset, onPick) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  const budget = asset.stats ? `${asset.stats.triangles} тр, ${asset.stats.kilobytes} КБ` : ready(asset);
  card.innerHTML = `${asset.title}<small>${budget}`
    + `<br>${new Date(asset.updated).toLocaleString('ru')}</small>`;
  card.addEventListener('click', () => onPick(asset));
  return card;
}

export function createLibrary(root, onPick) {
  return {
    async refresh() {
      const { assets } = await ask('/assets');
      root.replaceChildren(...assets.map((asset) => createCard(asset, onPick)));
      return assets;
    },
  };
}
