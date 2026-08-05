import findingsSource from '../../docs/FINDINGS.md?raw';

// Заголовок записи в журнале: "### F-001", дальше статус и название.
// Разделителем исторически бывает и обычная точка, и U+00B7, поэтому в шаблоне оба.
const ENTRY = new RegExp('^###\\s+F-(\\d+)\\s*[·.]\\s*(OPEN|CLOSED|INFO)\\s*[·.]\\s*(.+)$');
const SECTION = /^##\s+(?:\d+\.\s*)?(.+)$/;

const STATUS_LABELS = { OPEN: 'в работе', CLOSED: 'закрыто', INFO: 'факт' };

const listRoot = document.querySelector('[data-js-list]');
const countsRoot = document.querySelector('[data-js-counts]');
const filtersRoot = document.querySelector('[data-js-filters]');
const npcRoot = document.querySelector('[data-js-npc]');

const entries = parseFindings(findingsSource);
renderCounts(entries);
renderFilters();
renderEntries(entries);
loadWorldInventory();

function parseFindings(source) {
  const parsed = [];
  let section = '';
  let current = null;
  for (const line of source.split('\n')) {
    const sectionMatch = line.match(SECTION);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    const entryMatch = line.match(ENTRY);
    if (entryMatch) {
      const [, number, status, title] = entryMatch;
      current = { number, status, title: title.trim(), section, body: [] };
      parsed.push(current);
      continue;
    }
    if (current) current.body.push(line);
  }
  return parsed;
}

function renderCounts(items) {
  const tiles = [
    ['Всего записей', items.length],
    ['В работе', items.filter((item) => item.status === 'OPEN').length],
    ['Закрыто', items.filter((item) => item.status === 'CLOSED').length],
  ];
  countsRoot.replaceChildren(...tiles.map(([label, value]) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = `<b>${value}</b><span>${label}</span>`;
    return tile;
  }));
}

function renderFilters() {
  const options = [['ALL', 'Все'], ['OPEN', 'В работе'], ['CLOSED', 'Закрыто'], ['INFO', 'Факты']];
  for (const [value, label] of options) {
    const button = document.createElement('button');
    button.textContent = label;
    button.classList.toggle('is-active', value === 'ALL');
    button.addEventListener('click', () => {
      for (const sibling of filtersRoot.children) sibling.classList.remove('is-active');
      button.classList.add('is-active');
      renderEntries(value === 'ALL' ? entries : entries.filter((item) => item.status === value));
    });
    filtersRoot.append(button);
  }
}

function renderEntries(items) {
  if (!items.length) {
    listRoot.textContent = 'Ничего нет';
    return;
  }
  listRoot.replaceChildren(...items.map((item) => {
    const card = document.createElement('article');
    card.className = 'finding';
    card.innerHTML = `
      <header>
        <span class="badge badge--${item.status.toLowerCase()}">${STATUS_LABELS[item.status]}</span>
        <b>F-${item.number}</b>
        <span class="finding__title">${escapeHtml(item.title)}</span>
      </header>
      <p class="finding__section">${escapeHtml(item.section)}</p>
      <div class="finding__body">${renderBody(item.body.join('\n').trim())}</div>`;
    return card;
  }));
}

function escapeHtml(text) {
  return text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function renderBody(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

async function loadWorldInventory() {
  try {
    const world = await fetch('world.json').then((response) => response.json());
    const models = (world.npcs ?? []).filter((npc) => npc.src);
    if (!models.length) {
      npcRoot.textContent = 'Моделей в мире нет';
      return;
    }
    npcRoot.replaceChildren(...models.map((npc) => {
      const origin = npc.provenance ?? {};
      const row = document.createElement('article');
      row.className = 'npc';
      row.innerHTML = `
        <b>${escapeHtml(npc.name ?? npc.id)}</b>
        <small>${escapeHtml(npc.src)}</small>
        <p>модель: ${escapeHtml(origin.model ?? 'процедурная (свой код)')}</p>
        <p>риг: ${escapeHtml(origin.rig ?? 'свой авториг')}</p>
        <p>анимации: ${escapeHtml(origin.animations ?? 'процедурные клипы')}</p>`;
      return row;
    }));
  } catch (error) {
    npcRoot.textContent = `Мир не прочитался: ${error.message || error}`;
  }
}
