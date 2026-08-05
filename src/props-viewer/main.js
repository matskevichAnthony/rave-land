import { createViewer, measure } from '../model-viewer/scene.js';

const PROPS_DIR = 'assets/models/props/';
const MANIFEST = `${PROPS_DIR}manifest.json`;

const cardsRoot = document.querySelector('[data-js-cards]');
const countLabel = document.querySelector('[data-js-count]');
const viewerRoot = document.querySelector('[data-js-viewer]');
const canvasRoot = document.querySelector('[data-js-canvas]');
const statsRoot = document.querySelector('[data-js-stats]');
const nameLabel = document.querySelector('[data-js-name]');

const viewer = createViewer(canvasRoot, { cameraAt: [2.2, 1.8, 2.8], lookAt: [0, 0.8, 0] });

document.querySelector('[data-js-close]').addEventListener('click', closeViewer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeViewer();
});

showLibrary().catch((error) => {
  countLabel.textContent = `Опись не прочиталась: ${error.message}. `
    + 'Собери библиотеку: blender --background --python tools/gen/props.py';
});

/** Список берётся из manifest.json, который пишет props.py: страница не хранит свою копию. */
async function showLibrary() {
  const response = await fetch(MANIFEST);
  if (!response.ok) throw new Error(`${MANIFEST} отдал ${response.status}`);
  const { props } = await response.json();
  cardsRoot.replaceChildren(...props.map(createCard));
  countLabel.textContent = `В библиотеке пропов: ${props.length}.`;
}

function createCard(prop) {
  const card = document.createElement('button');
  card.className = 'card';
  card.innerHTML = `${prop.title}<small>${prop.triangles} тр, ${prop.kilobytes} КБ`
    + `<br>${prop.size.join(' x ')} м</small>`;
  card.addEventListener('click', () => openViewer(prop));
  return card;
}

function openViewer(prop) {
  const src = PROPS_DIR + prop.file;
  viewerRoot.hidden = false;
  nameLabel.textContent = prop.title;
  statsRoot.textContent = 'Загрузка...';
  viewer.resize();
  viewer.load(src)
    .then((gltf) => showStats(gltf.scene, prop.kilobytes))
    .catch((error) => {
      statsRoot.textContent = `Не загрузилось: ${error.message || error}`;
    });
}

function closeViewer() {
  viewerRoot.hidden = true;
  viewer.dispose();
  statsRoot.replaceChildren();
}

/** Полигонаж и габариты меряются по загруженному GLB: это сверка описи с самой моделью. */
function showStats(model, kilobytes) {
  const { triangles, size } = measure(model);
  const rows = [
    ['Треугольников', triangles],
    ['Габариты, м', [size.x, size.y, size.z].map((value) => value.toFixed(2)).join(' x ')],
    ['Размер файла', `${kilobytes} КБ`],
  ];
  statsRoot.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('p');
    row.className = 'stat';
    row.innerHTML = `<span>${label}</span><b>${value}</b>`;
    return row;
  }));
}
