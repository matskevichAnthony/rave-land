/** Системы игры, которые крутят готовый контент: короткая карта движка. */
export const RUNTIME_SYSTEMS = [
  {
    path: 'src/render/stage.js',
    title: 'Сцена и свет',
    summary: 'Рендерер, время суток и туман; поверх идут композитор эффектов и цветокоррекция.',
  },
  {
    path: 'src/terrain/terrain.js',
    title: 'Рельеф',
    summary: 'Холмы из шума по сиду, поляна в центре и физический heightfield под ними.',
  },
  {
    path: 'src/objects/registry.js',
    title: 'Объекты мира',
    summary: 'Спавн процедурных построек и GLB-моделей, коллайдер по bbox или по описанию сборщика.',
  },
  {
    path: 'src/anim/character-animator.js',
    title: 'Аниматор персонажа',
    summary: 'Слои и маски поверх базового клипа: ноги идут своим движением, руки держат оружие.',
  },
  {
    path: 'src/anim/skeleton-profile.js',
    title: 'Профили скелетов',
    summary: 'Определяет, чей это скелет, и находит кости и клипы по роли, а не по имени из конкретного пакета.',
  },
  {
    path: 'src/combat/weapon.js',
    title: 'Стрельба',
    summary: 'Ствол в руке, прицеливание и выстрел отрезком клипа на числах из weapon.dat.',
  },
  {
    path: 'src/combat/skinned-ragdoll.js',
    title: 'Рагдоллы',
    summary: 'Тело падает физикой Rapier, кости скина следуют за телами.',
  },
  {
    path: 'src/npc/system.js',
    title: 'NPC',
    summary: 'Население мира: загрузка моделей, блуждание, метки над головой и карточка происхождения ассета.',
  },
  {
    path: 'src/editor/editor.js',
    title: 'Редактор мира',
    summary: 'Расстановка объектов мышью, перетаскивание GLB в окно, экспорт world.json.',
  },
];
