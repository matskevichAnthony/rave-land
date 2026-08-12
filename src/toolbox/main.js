import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';

import { findingsMentioning, STATUS_LABELS } from '../docs/findings.js';
import { renderMarkdown } from '../docs/markdown.js';
import { createViewer, measure } from '../model-viewer/scene.js';
import { collectDocuments } from './documents.js';
import { collectInventory } from './inventory.js';
import { RUNTIME_SYSTEMS } from './runtime.js';
import { createThumbnails } from './thumbnails.js';
import { collectTools } from './tools.js';

const loader = new GLTFLoader();
const thumbnails = createThumbnails();

const countsRoot = document.querySelector('[data-js-counts]');
const inventoryRoot = document.querySelector('[data-js-inventory]');
const toolsRoot = document.querySelector('[data-js-tools]');
const runtimeRoot = document.querySelector('[data-js-runtime]');
const documentsRoot = document.querySelector('[data-js-documents]');
const viewerRoot = document.querySelector('[data-js-viewer]');
const canvasRoot = document.querySelector('[data-js-canvas]');
const statsRoot = document.querySelector('[data-js-stats]');
const clipsRoot = document.querySelector('[data-js-clips]');
const nameLabel = document.querySelector('[data-js-name]');

const viewer = createViewer(canvasRoot, { cameraAt: [2.2, 1.8, 2.8], lookAt: [0, 0.9, 0] });
let mixer = null;
let animate = null;
let framesHooked = false;

document.querySelector('[data-js-close]').addEventListener('click', closeViewer);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeViewer();
});

const toolSections = collectTools();
const documents = collectDocuments();
toolsRoot.replaceChildren(...toolSections.map(renderToolSection));
runtimeRoot.replaceChildren(...RUNTIME_SYSTEMS.map(renderRuntimeSystem));
documentsRoot.replaceChildren(...documents.map(renderDocument));

const previews = [];
const inventory = await collectInventory();
inventoryRoot.replaceChildren(...inventory.map(renderInventoryGroup));
countsRoot.replaceChildren(...renderCounts(inventory));
startPreviews();

/** Превью заказываются, когда карточки уже в документе: иначе их не видно наблюдателю видимости. */
function startPreviews() {
  for (const { canvas, card, item } of previews) {
    thumbnails.add(canvas, () => buildPreview(item)).catch((error) => {
      canvas.remove();
      card.prepend(create('span', 'card__failed', `Превью не собралось: ${error.message || error}`));
    });
  }
}

function renderCounts(groups) {
  const tools = toolSections.flatMap((section) => section.tools);
  const items = groups.flatMap((group) => group.items);
  const tiles = [
    ['Утилит в tools/', tools.length],
    ['Из них с правилами работы', tools.filter((tool) => tool.rules).length],
    ['Из них с открытым вопросом', tools.filter((tool) => isTroubled(tool)).length],
    ['Готовых моделей', items.filter((item) => item.src).length],
    ['Собирается кодом', items.filter((item) => item.build).length],
    ['Документов в docs/', documents.length],
  ];
  return tiles.map(([label, value]) => {
    const tile = create('div', 'tile');
    tile.append(create('b', null, value), create('span', null, label));
    return tile;
  });
}

function renderInventoryGroup(group) {
  const section = create('section', 'group');
  const heading = create('h3', 'group__title', group.title);
  heading.append(create('code', 'group__source', group.source));
  section.append(heading, create('p', 'group__lead', group.lead));
  if (group.error) {
    section.append(create('p', 'group__error', group.error));
    return section;
  }
  const grid = create('div', 'cards-grid');
  grid.append(...group.items.map(renderItemCard));
  section.append(grid);
  return section;
}

function renderItemCard(item) {
  const card = create('button', 'card card--model');
  const canvas = create('canvas', 'card__preview');
  const caption = create('span', 'card__caption', item.title);
  caption.append(create('small', null, item.subtitle));
  card.append(canvas, caption);
  card.addEventListener('click', () => openViewer(item));
  previews.push({ canvas, card, item });
  return card;
}

function buildPreview(item) {
  if (item.build) return item.build().object;
  return loader.loadAsync(item.src).then((gltf) => gltf.scene);
}

function renderToolSection(section) {
  const block = create('section', 'group');
  const heading = create('h3', 'group__title', section.title);
  heading.append(create('code', 'group__source', section.directory));
  block.append(heading);
  const grid = create('div', 'tools-grid');
  grid.append(...section.tools.map(renderToolCard));
  block.append(grid);
  return block;
}

function renderToolCard(tool) {
  const findings = findingsMentioning(tool.path);
  const card = create('article', 'tool');
  const header = create('header', 'tool__header');
  header.append(create('b', null, tool.title), renderBadge(findings));
  card.append(header, create('code', 'tool__path', tool.path), create('p', 'tool__summary', tool.summary));
  if (tool.input && tool.output) card.append(create('p', 'tool__io', `${tool.input} → ${tool.output}`));
  if (tool.command) card.append(create('pre', 'tool__command', tool.command));
  if (tool.rules) card.append(renderRules(tool.rules));
  card.append(renderFindings(findings));
  return card;
}

/** Правила лежат в docs/rules и цепляются к утилите сами: здесь их только показывают. */
function renderRules(rules) {
  const block = create('details', 'tool__rules');
  const summary = create('summary', 'tool__rules-summary', 'Правила работы');
  const body = create('div', 'tool__rules-body');
  body.append(renderMarkdown(rules));
  block.append(summary, body);
  return block;
}

function renderDocument(doc) {
  const block = create('details', 'document');
  const summary = create('summary', 'document__summary', doc.title);
  summary.append(create('code', 'document__path', doc.path));
  const body = create('div', 'document__body');
  body.append(renderMarkdown(doc.body));
  block.append(summary, body);
  return block;
}

/** Что известно про утилиту, берётся из журнала: своей отметки «работает» страница не держит. */
function renderBadge(findings) {
  if (!findings.length) return create('span', 'badge badge--unknown', 'в журнале нет');
  if (findings.some((entry) => entry.status === 'OPEN')) {
    return create('span', 'badge badge--open', 'есть открытый вопрос');
  }
  return create('span', 'badge badge--closed', 'проверено на практике');
}

function renderFindings(findings) {
  const list = create('ul', 'tool__findings');
  if (!findings.length) {
    list.append(create('li', 'tool__finding', 'В журнале пока не упоминается'));
    return list;
  }
  list.append(...findings.map((entry) => {
    const link = create('a', 'tool__finding-link', `F-${entry.number}`);
    link.href = `./status.html#F-${entry.number}`;
    const row = create('li', 'tool__finding');
    row.append(
      create('span', `badge badge--${entry.status.toLowerCase()}`, STATUS_LABELS[entry.status]),
      link,
      create('span', 'tool__finding-title', entry.title),
    );
    return row;
  }));
  return list;
}

function renderRuntimeSystem(system) {
  const row = create('article', 'system');
  row.append(
    create('b', null, system.title),
    create('code', 'system__path', system.path),
    create('p', null, system.summary),
  );
  return row;
}

function isTroubled(tool) {
  return findingsMentioning(tool.path).some((entry) => entry.status === 'OPEN');
}

function openViewer(item) {
  viewerRoot.hidden = false;
  nameLabel.textContent = item.title;
  statsRoot.textContent = 'Загрузка...';
  clipsRoot.replaceChildren();
  viewer.resize();
  if (!framesHooked) {
    viewer.onFrame(step);
    framesHooked = true;
  }
  if (item.build) {
    const { object, update } = item.build();
    animate = update ?? null;
    viewer.show(object);
    showStats(object);
    return;
  }
  viewer.load(item.src)
    .then((gltf) => {
      showStats(gltf.scene);
      mixer = new THREE.AnimationMixer(gltf.scene);
      showClips(gltf.animations);
    })
    .catch((error) => {
      statsRoot.textContent = `Не загрузилось: ${error.message || error}`;
    });
}

function step(delta) {
  if (mixer) mixer.update(delta);
  if (animate) animate(delta);
}

function showStats(object) {
  const { triangles, size } = measure(object);
  const rows = [
    ['Треугольников', Math.round(triangles)],
    ['Габариты, м', [size.x, size.y, size.z].map((value) => value.toFixed(2)).join(' x ')],
  ];
  statsRoot.replaceChildren(...rows.map(([label, value]) => {
    const row = create('p', 'stat');
    row.append(create('span', null, label), create('b', null, value));
    return row;
  }));
}

function showClips(clips) {
  if (!clips.length) {
    clipsRoot.append(create('p', 'viewer__hint', 'Анимаций в файле нет'));
    return;
  }
  let active = null;
  for (const clip of clips) {
    const button = create('button', null, `${clip.name} (${clip.duration.toFixed(1)}с)`);
    button.addEventListener('click', () => {
      if (active) {
        active.action.fadeOut(0.2);
        active.button.classList.remove('is-active');
      }
      const action = mixer.clipAction(clip);
      action.reset().fadeIn(0.2).play();
      button.classList.add('is-active');
      active = { action, button };
    });
    clipsRoot.append(button);
  }
  clipsRoot.firstChild.click();
}

function closeViewer() {
  viewerRoot.hidden = true;
  viewer.dispose();
  mixer = null;
  animate = null;
  framesHooked = false;
  statsRoot.replaceChildren();
  clipsRoot.replaceChildren();
}

function create(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
