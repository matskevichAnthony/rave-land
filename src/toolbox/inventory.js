import { ARCHETYPE_NAMES } from '../characters/archetypes.js';
import { buildCharacter } from '../characters/builder.js';
import { WEAPONS } from '../combat/weapons.js';
import { CHARACTERS } from '../models/characters.js';
import { OBJECT_BUILDERS, OBJECT_LABELS } from '../objects/library.js';
import { mulberry32 } from '../terrain/heightfield.js';

const PROPS_DIR = 'assets/models/props/';
const PROPS_MANIFEST = `${PROPS_DIR}manifest.json`;
const PREVIEW_SEED = 7;

/**
 * Всё, что в проекте есть в виде геометрии, одним списком групп.
 *
 * Ни одна группа не хранит свою копию списка: пропы приходят из описи, которую
 * пишет генератор, оружие из арсенала игры, процедурные объекты и персонажи
 * прямо из тех же сборщиков, которые работают в мире.
 */
export async function collectInventory() {
  return [
    await propsGroup(),
    weaponsGroup(),
    charactersGroup(),
    objectsGroup(),
    archetypesGroup(),
  ];
}

async function propsGroup() {
  const group = {
    id: 'props',
    title: 'Пропы',
    lead: 'Собраны скриптом из примитивов, список читается из описи генератора.',
    source: 'tools/gen/props.py',
    items: [],
  };
  try {
    const response = await fetch(PROPS_MANIFEST);
    if (!response.ok) throw new Error(`${PROPS_MANIFEST} отдал ${response.status}`);
    const { props } = await response.json();
    group.items = props.map((prop) => ({
      title: prop.title,
      subtitle: `${prop.triangles} тр, ${prop.kilobytes} КБ, ${prop.size.join(' x ')} м`,
      src: PROPS_DIR + prop.file,
    }));
  } catch (error) {
    group.error = `${error.message}. Собери библиотеку: blender --background --python tools/gen/props.py`;
  }
  return group;
}

function weaponsGroup() {
  return {
    id: 'weapons',
    title: 'Оружие',
    lead: 'Модели из San Andreas, числа и поведение из weapon.dat той же игры.',
    source: 'src/combat/weapons.js',
    items: WEAPONS.map((weapon) => ({
      title: weapon.name,
      subtitle: `${weapon.damage} урона, магазин ${weapon.magazine}, ${weapon.range} м`,
      src: weapon.model,
    })),
  };
}

function charactersGroup() {
  return {
    id: 'characters',
    title: 'Персонажи',
    lead: 'Готовые GLB со скелетом и клипами. Клипы включаются во вьюере, происхождение каждого на странице персонажей.',
    source: 'src/models/characters.js',
    items: CHARACTERS.map((character) => ({
      title: character.name,
      subtitle: character.src.split('/').at(-1),
      src: character.src,
    })),
  };
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
    })),
  };
}
