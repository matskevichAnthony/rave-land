import { createViewer, measure } from '../model-viewer/scene.js';

const PROPS = [
  { name: 'Стек колонок', src: 'assets/models/props/speaker-stack.glb' },
  { name: 'Ящик', src: 'assets/models/props/crate.glb' },
  { name: 'Бочка', src: 'assets/models/props/barrel.glb' },
  { name: 'Ограждение', src: 'assets/models/props/barrier.glb' },
];

const cardsRoot = document.querySelector('[data-js-cards]');
const viewerRoot = document.querySelector('[data-js-viewer]');
const canvasRoot = document.querySelector('[data-js-canvas]');
const statsRoot = document.querySelector('[data-js-stats]');
const nameLabel = document.querySelector('[data-js-name]');

const viewer = createViewer(canvasRoot, { cameraAt: [2.2, 1.8, 2.8], lookAt: [0, 0.8, 0] });

for (const prop of PROPS) {
  const card = document.createElement('button');
  card.className = 'card';
  card.innerHTML = `${prop.name}<small>${prop.src.split('/').pop()}</small>`;
  card.addEventListener('click', () => openViewer(prop));
  cardsRoot.append(card);
}

document.querySelector('[data-js-close]').addEventListener('click', closeViewer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeViewer();
});

function openViewer(prop) {
  viewerRoot.hidden = false;
  nameLabel.textContent = prop.name;
  statsRoot.textContent = 'Загрузка...';
  viewer.resize();
  viewer.load(prop.src)
    .then((gltf) => showStats(gltf.scene, prop.src))
    .catch((error) => {
      statsRoot.textContent = `Не загрузилось: ${error.message || error}`;
    });
}

function closeViewer() {
  viewerRoot.hidden = true;
  viewer.dispose();
  statsRoot.replaceChildren();
}

async function showStats(model, src) {
  const { triangles, size } = measure(model);
  const response = await fetch(src, { method: 'HEAD' });
  const bytes = Number(response.headers.get('content-length'));
  const rows = [
    ['Треугольников', triangles],
    ['Габариты, м', [size.x, size.y, size.z].map((value) => value.toFixed(2)).join(' x ')],
    ['Размер файла', bytes ? `${Math.round(bytes / 1024)} КБ` : 'неизвестен'],
  ];
  statsRoot.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('p');
    row.className = 'stat';
    row.innerHTML = `<span>${label}</span><b>${value}</b>`;
    return row;
  }));
}
