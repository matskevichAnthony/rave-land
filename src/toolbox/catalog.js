/**
 * Опись мастерской: чем и какой командой делается контент проекта.
 *
 * Статуса тут нет намеренно. Страница сама достаёт из docs/FINDINGS.md записи, где
 * упомянут файл утилиты, и показывает их. Работает или сломано живёт в журнале.
 */

export const TOOL_SECTIONS = [
  {
    title: 'Генерация 3D-моделей',
    lead: 'Три разных способа получить меш: облако, локальный CPU и просто скрипт из примитивов.',
    tools: [
      {
        path: 'tools/gen/image2mesh.py',
        title: 'Картинка в меш через облако',
        summary: 'Гонит PNG через бесплатные HF Spaces (по умолчанию Hunyuan3D-2, вторым TRELLIS) и приносит GLB. Очередь публичная, поэтому ждать приходится минутами; когда у Space меняется сигнатура, скрипт печатает свежий view_api, чтобы было видно новые эндпоинты.',
        input: 'PNG, персонаж в T-позе на светлом фоне',
        output: 'GLB-меш без скелета',
        command: 'python3 tools/gen/image2mesh.py _other/incoming/hero.png _other/hero-rig/mesh-raw.glb --space hunyuan',
      },
      {
        path: 'tools/gen/triposr_local.py',
        title: 'Картинка в меш локально, без интернета',
        summary: 'TripoSR на голом CPU этой машины: чекпоинт открывается через mmap, пик памяти держится около 2.2 ГБ, сторож обрывает прогон, если свободная память проваливается. Страховка на случай мёртвой очереди Space.',
        input: 'PNG, тот же кадр что и для облака',
        output: 'GLB-меш, качество ниже облачного',
        command: 'cd _other/local-gen && HF_HOME=$PWD/weights ./venv/bin/python ../../tools/gen/triposr_local.py hero.png out/hero.glb --mc-resolution 256',
      },
      {
        path: 'tools/gen/props.py',
        title: 'Пропы рейв-поля из примитивов',
        summary: 'Blender headless собирает ящики, бочки, фермы и барную стойку из кубов и цилиндров, детерминированно по сиду и сразу в бюджете сотен треугольников. Рядом пишется manifest.json, из которого библиотека попадает на страницы сама.',
        input: 'имя пропа и сид',
        output: 'GLB плюс строка в manifest.json',
        command: '_other/auto-rig/blender-4.2.9-linux-x64/blender --background --python tools/gen/props.py -- --prop all --out-dir public/assets/models/props',
      },
    ],
  },
  {
    title: 'Скелет и анимации',
    lead: 'Мокап приводится к BVH, ретаргетится на скелет персонажа и вклеивается клипом в игровой GLB.',
    tools: [
      {
        path: 'tools/anim/bvh2clip',
        title: 'BVH в игровой клип',
        summary: 'Одна команда на весь путь: запускает ретаргет в Blender, вклеивает готовый клип под своим именем в GLB персонажа и прогоняет постобработку.',
        input: 'BVH плюс имя клипа',
        output: 'обновлённый public/assets/models/character-animated.glb',
        command: 'tools/anim/bvh2clip _other/mocap/bandai/dataset-1_walk_normal_001.bvh Walk --rig-dir _other/hero-rig',
      },
      {
        path: 'tools/anim/retarget.py',
        title: 'Ретаргет мокапа на скелет',
        summary: 'Ядро переноса движения. Rest-поза источника непригодна, поэтому кадры считаются абсолютными мировыми дельтами от опорного кадра, а опорный кадр позиционно подгоняется к rest-позе цели по направлению кости.',
        input: 'BVH и rig.blend из каталога персонажа',
        output: 'GLB с новым клипом',
        command: 'blender -b --python tools/anim/retarget.py -- --bvh clip.bvh --name Walk --raw tools/anim/build/raw.glb --rig-dir _other/hero-rig',
      },
      {
        path: 'tools/anim/ifp2bvh.py',
        title: 'Анимации GTA в BVH',
        summary: 'В ped.ifp лежат только повороты, скелет к ним не приложен, поэтому недостающую иерархию скрипт держит у себя: она вычитана из стокового male01.dff. На выходе обычный BVH, который дальше идёт общим маршрутом.',
        input: 'ped.ifp и имя анимации',
        output: 'BVH',
        command: 'python3 tools/anim/ifp2bvh.py "Стандартные анимации/ped.ifp" WALK_civi -o _other/mocap/gta/walk.bvh',
      },
      {
        path: 'tools/anim/bvh_writer.py',
        title: 'Общий писатель BVH',
        summary: 'Место, где живёт вся сторона BVH: ресемпл на постоянный fps, порядок каналов, сантиметры и разворот осей под импортёр Blender. Новый источник анимаций пишет только свой адаптер, а не свой формат.',
        input: 'дерево костей и ключи в метрах',
        output: 'файл BVH',
        command: null,
      },
      {
        path: 'tools/anim/preview.py',
        title: 'Кадры клипа картинками',
        summary: 'Рендерит несколько кадров выбранных клипов из готового GLB, чтобы глазами оценить качество ретаргета, не заходя в игру.',
        input: 'GLB и список клипов',
        output: 'PNG по кадрам',
        command: 'blender -b --python tools/anim/preview.py -- --glb public/assets/models/character-animated.glb --clips Dance,Walk',
      },
    ],
  },
  {
    title: 'Импорт из GTA San Andreas',
    lead: 'Свои читатели форматов Rockstar, без сторонних библиотек. Прототипу это даёт готовое население, оружие и мокап.',
    tools: [
      {
        path: 'tools/gta/img.py',
        title: 'Архивы IMG',
        summary: 'Распаковывает архивы версии VER2, где смещения и размеры считаются секторами по 2048 байт. Отсюда достаются модели и текстуры.',
        input: 'gta3.img',
        output: 'файлы dff и txd',
        command: "python3 tools/gta/img.py anim.img --extract _other/gta --only '*.ifp'",
      },
      {
        path: 'tools/gta/dff.py',
        title: 'Модели DFF',
        summary: 'Читает RenderWare clump целиком: иерархию фреймов с костями, геометрию, материалы и Skin PLG с весами и обратными матрицами привязки. Каждый чанк дочитывается до объявленного конца, поэтому ошибка в ширине поля видна сразу.',
        input: 'файл dff',
        output: 'меш, скелет, веса',
        command: 'python3 tools/gta/dff.py _other/gta/male01.dff --skeleton',
      },
      {
        path: 'tools/gta/txd.py',
        title: 'Текстуры TXD',
        summary: 'Свой декодер DXT1, DXT3, DXT5 и всей россыпи несжатых и палитровых форматов. Pillow нужен только чтобы записать PNG.',
        input: 'файл txd',
        output: 'PNG',
        command: 'python3 tools/gta/txd.py _other/gta/male01.txd --extract _other/gta/textures',
      },
      {
        path: 'tools/gta/dff2glb.py',
        title: 'Модель GTA в игровой GLB',
        summary: 'Сборка всего вместе: модель, текстуры и выбранные анимации проходят через портативный Blender и общую постобработку, на выходе персонаж, готовый лечь в мир.',
        input: 'dff, txd, пакеты ifp',
        output: 'GLB со скелетом и клипами',
        command: 'python3 tools/gta/dff2glb.py _other/gta/male01.dff -o public/assets/models/gta-grove.glb --txd _other/gta/male01.txd',
      },
      {
        path: 'tools/gta/ifp.py',
        title: 'Пакеты анимаций IFP',
        summary: 'Читатель формата ANP3, разобранного экспериментально: опубликованные спеки врут про масштаб времени, поэтому константы здесь свои, проверенные на ped.ifp.',
        input: 'файл ifp',
        output: 'клипы с ключами по костям',
        command: 'python3 tools/gta/ifp.py "Стандартные анимации/ped.ifp" --list',
      },
      {
        path: 'tools/gta/weapondat.py',
        title: 'weapon.dat в JSON арсенала',
        summary: 'Из игрового weapon.dat достаётся не только баланс, но и поведение: кадры animLoop задают позу прицеливания и отрезок клипа на выстрел, hex-флаги говорят, можно ли целиться на ходу и одной ли рукой держится ствол. Результат лежит в src/combat/weapons.json.',
        input: 'weapon.dat',
        output: 'src/combat/weapons.json',
        command: 'python3 tools/gta/weapondat.py "Стандартная папка data/data/weapon.dat" -o src/combat/weapons.json --only PISTOL,DESERT_EAGLE,SHOTGUN,AK47,M4',
      },
    ],
  },
  {
    title: 'Сборка',
    lead: 'Последний шаг любого маршрута: без него GLB весит десятки мегабайт.',
    tools: [
      {
        path: 'tools/postprocess.mjs',
        title: 'Ужимание GLB',
        summary: 'Ресемпл анимаций, дедуп, прунинг, текстуры в webp и квантизация. Draco и meshopt не берём: загрузчик игры без декодеров, а KHR_mesh_quantization и EXT_texture_webp он понимает сам.',
        input: 'сырой GLB',
        output: 'GLB в разы легче',
        command: 'cd tools && npm i && node postprocess.mjs raw.glb ../public/assets/models/hero.glb',
      },
    ],
  },
];

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
