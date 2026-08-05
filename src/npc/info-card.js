export function createInfoCard() {
  const card = document.createElement('aside');
  card.className = 'npc-card';
  card.hidden = true;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'npc-card__close';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'Закрыть карточку');

  const name = document.createElement('h2');
  name.className = 'npc-card__name';

  const archetype = document.createElement('p');
  archetype.className = 'npc-card__archetype';

  const dataList = document.createElement('dl');
  dataList.className = 'npc-card__data';

  const provenanceTitle = document.createElement('h3');
  provenanceTitle.className = 'npc-card__provenance-title';
  provenanceTitle.textContent = 'Происхождение ассета';

  const provenanceList = document.createElement('dl');
  provenanceList.className = 'npc-card__data npc-card__provenance';

  card.append(closeButton, name, archetype, dataList, provenanceTitle, provenanceList);
  document.body.appendChild(card);

  function hide() {
    card.hidden = true;
  }

  function show(entry) {
    name.textContent = entry.name;
    archetype.textContent = entry.archetype;
    dataList.replaceChildren(...dataRows(entry.data ?? {}));
    const provenance = provenanceOf(entry);
    provenanceTitle.hidden = !provenance;
    provenanceList.hidden = !provenance;
    provenanceList.replaceChildren(...dataRows(provenance ?? {}));
    card.hidden = false;
  }

  closeButton.addEventListener('click', hide);

  return { show, hide };
}

const PROVENANCE_LABELS = {
  model: '3D-модель',
  rig: 'Риг',
  animations: 'Анимации',
};

const PROCEDURAL_PROVENANCE = {
  model: 'процедурный генератор (свой код)',
  rig: 'процедурный (свой код)',
  animations: 'процедурные (свой код)',
};

function provenanceOf(entry) {
  const source = entry.provenance ?? (entry.src ? null : PROCEDURAL_PROVENANCE);
  if (!source) return null;
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [PROVENANCE_LABELS[key] ?? key, value]),
  );
}

function dataRows(data) {
  return Object.entries(data).flatMap(([key, value]) => {
    const term = document.createElement('dt');
    term.className = 'npc-card__key';
    term.textContent = key;
    const detail = document.createElement('dd');
    detail.className = 'npc-card__value';
    detail.textContent = String(value);
    return [term, detail];
  });
}
