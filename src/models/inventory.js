import { ARCHETYPE_NAMES } from '../characters/archetypes.js';
import { buildCharacter } from '../characters/builder.js';
import { WEAPONS } from '../combat/weapons.js';
import { OBJECT_BUILDERS, OBJECT_LABELS } from '../objects/library.js';
import { mulberry32 } from '../terrain/heightfield.js';

/**
 * Всё содержимое проекта одним списком групп для страницы.
 *
 * Файлы приходят из описи `assets/inventory.json`, которую собирает с диска
 * плагин `tools/inventory`, поэтому свежий проп виден сразу после
 * перезагрузки. Здесь к ним добавляется то, чего на диске нет: постройки и
 * заглушки персонажей живут кодом и собираются теми же сборщиками, что в игре.
 */

const INVENTORY = 'assets/inventory.json';
const PREVIEW_SEED = 7;

const GROUPS = {
  props: {
    title: 'Процедурные пропы',
    source: 'tools/gen/props.py',
    lead: 'Собраны из примитивов в Blender, детерминированно по сиду. ИИ для такой геометрии не нужен (F-020).',
  },
  generated: {
    title: 'Прогоны генератора',
    source: 'public/assets/generated',
    lead: 'Маршрут «промпт, картинка, меш, лоуполи» со страницы генератора. Прогон попадает сюда сам, как только на диске появился его файл.',
  },
  characters: {
    title: 'Персонажи',
    source: 'public/world.json',
    lead: 'Готовые GLB со скелетом и клипами. Клипы включаются во вьюере, происхождение записано у каждого.',
  },
  gta: {
    title: 'Импорт из GTA San Andreas',
    source: 'tools/gta/dff2glb.py',
    lead: 'Свои читатели .dff, .txd и .ifp. Ассеты Rockstar: локальный прототип, в публикацию и в релиз им нельзя (F-041).',
  },
  unknown: {
    title: 'Происхождение не записано',
    source: 'public/assets/provenance.json',
    lead: 'Файлы лежат, а чем сделаны, нигде не сказано. Лечится записью в provenance.json.',
  },
};

const WEAPON_BY_SRC = new Map(WEAPONS.map((weapon) => [weapon.model, weapon]));

export async function collectInventory() {
  const codeGroups = [objectsGroup(), archetypesGroup()];
  try {
    const assets = await loadAssets();
    const fileGroups = Object.entries(GROUPS)
      .map(([id, group]) => ({ ...group, id, items: assets.filter((asset) => asset.source === id).map(toItem) }))
      .filter((group) => group.items.length);
    return [...fileGroups, ...codeGroups];
  } catch (error) {
    return [{
      id: 'files',
      title: 'Файлы моделей',
      source: INVENTORY,
      lead: 'Опись собирается плагином tools/inventory при запросе страницы и при сборке.',
      error: `Опись не прочиталась: ${error.message}`,
      items: [],
    }, ...codeGroups];
  }
}

async function loadAssets() {
  const response = await fetch(INVENTORY);
  if (!response.ok) throw new Error(`${INVENTORY} отдал ${response.status}`);
  return (await response.json()).assets;
}

function toItem(asset) {
  const weapon = WEAPON_BY_SRC.get(asset.src);
  return {
    title: weapon?.name ?? asset.title,
    subtitle: describe(asset, weapon),
    src: asset.src,
    preview: asset.preview ?? null,
    provenance: asset.provenance,
    license: asset.provenance.license ?? null,
  };
}

function describe(asset, weapon) {
  const parts = [
    asset.triangles === null ? 'только картинка' : `${asset.triangles} тр`,
    `${asset.kilobytes} КБ`,
    asset.size ? `${asset.size.join(' x ')} м` : null,
    asset.inWorld ? `в мире ${asset.inWorld}` : null,
    weapon ? `${weapon.damage} урона, магазин ${weapon.magazine}` : null,
    asset.problem,
  ];
  return parts.filter(Boolean).join(', ');
}

function objectsGroup() {
  return {
    id: 'objects',
    title: 'Процедурные постройки',
    lead: 'Живут кодом, а не файлами: редактор ставит их в мир и каждый раз по сиду немного другими.',
    source: 'src/objects/library.js',
    items: Object.entries(OBJECT_BUILDERS).map(([type, builder]) => ({
      title: OBJECT_LABELS[type] ?? type,
      subtitle: `${type}, сид ${PREVIEW_SEED}`,
      build: () => builder(mulberry32(PREVIEW_SEED)),
      provenance: { model: 'собирается кодом при загрузке мира, файла на диске нет' },
    })),
  };
}

function archetypesGroup() {
  return {
    id: 'archetypes',
    title: 'Процедурные персонажи',
    lead: 'Заглушки на время: тело из примитивов и рисованные текстуры. Население мира приходит генераторами и импортом.',
    source: 'src/characters/builder.js',
    items: ARCHETYPE_NAMES.map((archetype) => ({
      title: archetype,
      subtitle: `сид ${PREVIEW_SEED}`,
      build: () => buildCharacter({ archetype, seed: PREVIEW_SEED }),
      provenance: { model: 'собирается кодом при спавне NPC, файла на диске нет' },
    })),
  };
}
