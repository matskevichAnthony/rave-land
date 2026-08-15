# Вход в репозиторий

Rave Land это не игра, а конструктор миров: движок общий, а конкретный мир задаётся данными.
Стек vanilla JS + Vite + three + Rapier, без фреймворков и без сборочной магии.
Прочитай этот файл целиком до первой правки, он написан ровно чтобы ты не открывал устройство
проекта заново.

## Слои

| Слой | Где | Что там |
| --- | --- | --- |
| Данные мира | `public/world.json`, `public/understav.json` | рельеф, объекты, NPC, точки возрождения; событие, лайнап, состав гостей, сид |
| Движок | `src/render`, `src/player`, `src/npc`, `src/combat`, `src/audio`, `src/hud`, `src/procedural`, `src/terrain`, `src/objects`, `src/anim`, `src/characters`, `src/ui` | всё, что не знает ни про один конкретный мир |
| Сцена | `src/understav/*` | промо-сцена UNDERSTAV: своя архитектура, камера, постобработка, пульт |
| Ассеты и опись | `public/assets`, `tools/inventory` | GLB, звуки, происхождение в `public/assets/provenance.json`; опись собирается с диска |
| Конвейер | `tools/gen`, `tools/gta`, `tools/anim` | картинка в меш, риг, ретаргет, разбор архивов San Andreas |

## Правило номер один

Знание про конкретный мир не зашивается в код, оно живёт в данных. Имена гостей, состав фракций,
координаты, дата события, список моделей приходят из json. Если ты пишешь в модуле движка строку
вроде `assets/models/gta-triad.glb` или число вроде `crowd: 7`, ты делаешь движок непереносимым.
Проверка простая: скопируй сцену под другое событие, поменяв только данные. Не вышло, значит
знание утекло в код.

## Что уже готово, звать по имени

Ничего из этого списка переписывать не надо.

* Игрок: `createPlayer({ RAPIER, physicsWorld, terrain, scene })` в `src/player/player.js` и
  `createFollowCamera(camera, domElement, terrain)` в `src/player/follow-camera.js`. Ходьба,
  присед, прыжок, прицеливание, следящая камера. Габариты и скорости в `PLAYER` из `src/config.js`.
* Население: `createNpcSystem({ scene, camera, terrain, renderer })` в `src/npc/system.js`.
  Методы `add`, `remove`, `update`, `attachArena`, `serialize`. Анимация считается по LOD от
  дистанции, поэтому толпа не стоит кадра.
* Бой: `createArena({ RAPIER, physicsWorld, scene, terrain, npcSystem, ragdolls, audio,
  coverObjects, playerCollider })` в `src/combat/arena.js` (боты, укрытия, счёт, шаг 30 Гц) и
  `createPlayerCombat({ camera, domElement, player, followCam, arena, npcSystem, isEditing })`
  в `src/combat/weapon.js` (ствол игрока, огонь, перезарядка). События боя в `src/combat/events.js`,
  счёт в `src/combat/scoreboard.js`.
* Боевой HUD: `createBattleHud({ camera, scoreboard, playerFighter })` в `src/hud/battle-hud.js`,
  `createCrosshair()`, `createCombatHud()`. Разметку берут со страницы через
  `ensure(selector, markup)` из `src/ui/dom.js`, а если её там нет, заводят сами. Новой странице
  достаточно импортировать стили.
* Процедурная геометрия: `buildInstanced(geometry, material, count, place, tint)` в
  `src/procedural/instancing.js` и заготовки форм в `src/procedural/shapes.js` (единичные, метры
  приходят масштабом инстанса). Десятки одинаковых мешей это ошибка, а не решение.
* Запись холста: `createCanvasRecorder(canvas)` в `src/understav/record.js`, отдаёт mp4, webm
  запасным. Пульт и HUD в файл не попадают, пишется только холст.
* Сид: `createRandom(seed)` в `src/understav/random.js` (плюс `.range`, `.int`, `.pick`, `.sign`)
  и `mulberry32` в `src/terrain/heightfield.js` для движка. Один сид даёт один и тот же мир.

## Бюджет кадра

Числа стоят в `src/understav/palette.js`: `FRAME_BUDGET` это 140 вызовов отрисовки,
400 000 треугольников, 6 источников света, 60 кадров в секунду. Бюджет попадает в задание до
кода, а не подгоняется после.

Замер виден в пульте страницы `understav.html`, блок «Замер» (`[data-js-stats]`): кадров в
секунду, худший кадр в миллисекундах, вызовы отрисовки, треугольники. Превышение подсвечивается.
Смотреть надо на худший кадр, средний врёт. Замер до правки и после, иначе сравнивать не с чем.

## Как посмотреть результат

`npm run dev` поднимает Vite. Страницы:

* `index.html` (`src/main.js`) основной мир: рельеф, игрок, население, бой, редактор по Tab.
* `understav.html` (`src/understav/main.js`) промо-сцена: афиша, режимы камеры, прогулка, съёмка.
* `toolbox.html` (`src/toolbox/main.js`) мастерская: опись ассетов, вьюер GLB, документы.
* `generator.html` (`src/generator/main.js`) генератор ассетов.
* `status.html` (`src/status/main.js`) состояние проекта.

Головой смотреть необязательно, есть headless-снимок. В скретчпаде сессии лежит `frame.mjs`
на playwright (chromium со swiftshader, окно 900 на 900). Аргументы по порядку:

```
node frame.mjs <адрес> <файл.png> <пауза мс> <кадрирование> <режим камеры> <пауза после мс>
```

Кадрирование это `square`, `story`, `wide`, `full`, режим камеры `still`, `orbit`, `descend`,
`approach`, `free`, `walk`. Скрипт кликает `[data-js-framing]` и `[data-js-mode]`, ждёт, жмёт
«Кадр» (`[data-js-capture]`), сохраняет снимок и печатает две строки: замер и ошибки консоли или
«консоль чистая». Перестрелка включается кнопкой `[data-js-battle]`. Снимок берётся с холста,
поэтому HUD в нём не виден: чтобы проверить HUD, снимай `page.screenshot`, а не «Кадр».
Скрипт живёт в скретчпаде и до следующей сессии не доживает, он на двадцать строк, пиши заново.

## Запреты

* Ассеты San Andreas (`gta-*.glb`, звуки, анимации из архивов) в промо реального события.
  Это чужой контент, в сцене UNDERSTAV его быть не должно; геометрия либо процедурная, либо из
  `public/assets/models/props` и `public/assets/generated`.
* `Math.random` в сценах. Только сид: сцена обязана повторяться по своему сиду.
* Длинное тире в любых файлах, его блокирует хук на записи.
* Новые зависимости. В `package.json` ровно три: rapier, simplex-noise, three, и vite в dev.
  Всё остальное пишется руками или не пишется вовсе.
* Разметка как контракт. JS цепляется за `data-js-*` и существующие `data-*`, не за классы и id.

## Куда смотреть дальше

* `docs/creative-enhancer.md` как придумывается сцена. Читать до того, как писать сцену: лист сцены, словари объектов и глаголов, ограничители и гейт, которым отсекается мусор.
* `docs/plans/world-engine.md` разрыв между целью (движок миров) и тем, что в репозитории.
* `docs/plans/understav.md` контракт сцены: модули, сигнатуры, бюджет, запреты.
* `docs/PIPELINE.md` конвейер «картинка в персонажа с анимацией», три маршрута.
* `tools/README.md` пошаговые команды конвейера.
* `docs/FINDINGS.md` накопленные наблюдения по ассетам и производительности.

## Известные дыры

Знай про них до того, как споткнёшься. Сцена UNDERSTAV собрана кодом, а не данными: геометрия
нефа живёт в `src/understav/architecture.js`, а не в json, так что второе событие потребует
второго файла на две тысячи строк. Схемы мира и валидатора нет вовсе: `public/world.json` можно
сломать опечаткой, и никто не скажет ни слова. `PLAYER` в `src/config.js` это глобальный
изменяемый объект, и вход в прогулку по сцене перезаписывает его через `Object.assign`, так что
основной мир в той же вкладке получает чужую внешность и фракцию. `src/understav/colliders.js`
держит копию чисел расстановки из `architecture.js` (пилоны, колонны коридора, ступени алтаря,
бочки) и признаётся в этом комментарием: правишь одно, правь оба. Сид (`src/understav/random.js`)
и бюджет кадра (`src/understav/palette.js`) лежат в папке сцены, хотя нужны всему движку, поэтому
генераторов случайности в проекте два и они не связаны. Стили HUD движка (`styles/battle.css`,
`styles/vitals.css`) написаны на токенах из `styles/base.css`, которых на страницах сцены нет, и
панели рисуются без подложки.
