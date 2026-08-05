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

  card.append(closeButton, name, archetype, dataList);
  document.body.appendChild(card);

  function hide() {
    card.hidden = true;
  }

  function show(entry) {
    name.textContent = entry.name;
    archetype.textContent = entry.archetype;
    dataList.replaceChildren(...dataRows(entry.data ?? {}));
    card.hidden = false;
  }

  closeButton.addEventListener('click', hide);

  return { show, hide };
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
