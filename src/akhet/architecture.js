/**
 * Площадка AKHET: песок до горизонта, дорога с фигурами, пилон и вихрь над всем этим.
 *
 * Мир открытый. Глубина здесь строится расстоянием, а не стенами: ближний план это следы
 * и обломки под ногами, средний это боги и ворота, дальний это пирамиды, съеденные
 * маревом. Ни одна из трёх дистанций не имеет права быть пустой, иначе кадр становится
 * плоским задником.
 *
 * Сами вещи приходят из `props.js`: пирамида, обелиск, пилон, боги, сфинкс, стела, ладья
 * и обломки. Здесь только расстановка, материал и песок. Каждый монумент берётся слитой
 * геометрией и получает материал сцены, поэтому палитра кадра задаётся в одном месте.
 *
 * Огонь строит `fire.js`, а места ему даёт эта расстановка: аллея и монументы, помеченные
 * `fire`. Своего списка координат у огня нет, и подвинутая фигура уводит очаг за собой.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  BOUNDS, COLONNADE, DOOR, HALL, VORTEX,
  createSitePlan, planColumns, planCorridor, planRadius,
} from './hall.js';
import { createMaterials, createStoneMaps, stoneBox } from './stone.js';
import { createDrifts, createDunes, createRipples, createSand, createTracks } from './dunes.js';
import { createSky } from './sky.js';
import { createVortex } from './vortex.js';
import { createRelics, RELIC_FIRES } from './relics.js';
import { createFire, footHearth } from './fire.js';
import { propGeometry, propMaterial } from './props.js';
import { buildInstanced } from '../procedural/instancing.js';
import { between } from '../procedural/random.js';

const TAU = Math.PI * 2;

/** Право дальней пирамиды отойти от своего места, если оно занято, в метрах. */
const FIELD_DRIFT = 60;

/**
 * Расстановка монументов.
 *
 * `sink` это доля высоты, ушедшая в песок: пустыня забирает основания, и вещь, стоящая
 * на песке ровно подошвой, читается декорацией. `stone` выбирает материал: известняк
 * работает светом, а гранит силуэтом. `fire` ставит к подножию жаровню: горит не у всякой
 * вещи, а у той, к которой ходят.
 *
 * Фигур людей и богов здесь больше нет. Процедурная фигура пересобирается на каждом сиде и
 * набирается из тёсаных блоков: на дальнем плане и в аллее это читается силуэтом, а крупно
 * в кадре афиши читается кубизмом. Крупные роли ушли музейным сканам в `relics.js`,
 * процедурным осталась аллея сфинксов и мелочь у горизонта.
 *
 * Расчёт дистанций по афишной точке: вещь в семидесяти метрах занимает почти половину
 * высоты кадра, она же у ворот, в ста десяти, занимала восьмую и терялась точкой у
 * горизонта. Дальше семидесяти метров уезжает только то, что и должно читаться далёким:
 * ворота, обелиск и пирамиды.
 *
 * `drift` это право отойти от своего места, когда оно занято, в метрах. У ближних фигур
 * его нет: их точки выставлены по углам афишного кадра, и сдвинутая на метр фигура ломает
 * композицию сильнее, чем чужой круг. У дальних пирамид оно большое: там важно, что поле
 * стоит полем, а не то, где именно стоит каждая.
 *
 * Пирамиды разведены по своим габаритам: у стометровой основание в полтораста метров, и
 * пары соседок, стоявших в сотне метров друг от друга, врастали одна в другую.
 *
 * Ближний кластер уехал вправо на четырнадцать метров против прежнего. Афишная камера
 * садится на середину типографики, и всё, что стояло левее дороги, приходилось ровно на
 * буквы: с этой точки монумент имени и стелы лайнапа закрывают полосу шириной в тридцать
 * пять градусов, а фигуры в шестидесяти метрах занимали её середину. Четырнадцать метров
 * это тот вынос, на котором силуэты выходят из-за букв и ещё не уезжают за правый край
 * кадра. Вещи, которым сдвиг пришёлся ровно на ряд сфинксов, перешагнули ряд и встали в
 * самой аллее: полоса дороги в этом кадре и есть то место, где их видно.
 *
 * Пилон и стоящий обелиск при сдвиге остались на месте: по ним ставят лестницу и коллайдер
 * порога, и уехавшие ворота оторвались бы от собственных ступеней.
 */
const LANDMARKS = [
  { prop: 'pyramid', x: -296, z: -162, height: 84, turn: 0.2, stone: 'prop', drift: FIELD_DRIFT },
  { prop: 'pyramid', x: -185, z: -179, height: 46, turn: -0.3, stone: 'prop', drift: FIELD_DRIFT },
  { prop: 'pyramid', x: -170, z: -343, height: 105, turn: 0.5, stone: 'prop', drift: FIELD_DRIFT },
  { prop: 'pyramid', x: 18, z: -312, height: 62, turn: 0.1, stone: 'prop', drift: FIELD_DRIFT },
  { prop: 'pyramid', x: 55, z: -232, height: 38, turn: -0.4, stone: 'prop', drift: FIELD_DRIFT },

  { prop: 'pylon', x: 0, z: -51, height: DOOR.top, turn: 0, stone: 'prop' },
  { prop: 'obelisk', x: -11.5, z: -40, height: 23, turn: 0, stone: 'prop' },
  { prop: 'obelisk', x: 30, z: 4, height: 19, turn: 0.7, stone: 'prop', fallen: 0.42 },
  { prop: 'stela', x: -5, z: -16, height: 4.6, turn: -0.5, stone: 'prop', sink: 0.2 },
  { prop: 'stela', x: 39, z: -16, height: 6, turn: 0.9, stone: 'prop', sink: 0.34 },
  { prop: 'offeringTable', x: -16.5, z: -6, height: 1.4, turn: 0.3, stone: 'prop' },
  { prop: 'canopicJar', x: -18, z: -4.6, height: 1.1, turn: 1.2, stone: 'prop' },
  { prop: 'canopicJar', x: -15.2, z: -4, height: 1, turn: -0.6, stone: 'prop', sink: 0.15 },

  { prop: 'buriedBase', x: 14, z: -4, height: 3.4, turn: 0.5, stone: 'prop' },
  { prop: 'buriedBase', x: 30, z: -30, height: 4.2, turn: -0.4, stone: 'prop' },
  { prop: 'solarBarque', x: 17, z: -13, height: 4.2, turn: 2.1, stone: 'prop', sink: 0.38 },
];

/** Лестница перед воротами: три уступа по числам порога, тем же, что у коллайдеров. */
const STAIRS = { steps: 3, run: 1.4 };

const AVENUE = { sink: [0.05, 0.34], tilt: 0.09, turn: 0.12 };

const SCATTER = {
  count: 52,
  size: [0.4, 1.7],
  fields: [
    { x: VORTEX.x, z: VORTEX.z, radius: VORTEX.craterRadius * 1.6, share: 0.3 },
    { x: 0, z: -46, radius: 18, share: 0.3 },
    { x: -12, z: -16, radius: 24, share: 0.4 },
  ],
  sink: 0.35,
};

/**
 * Гряда на горизонте слева: те же обломки, только величиной со скалу.
 *
 * Левый край кадра держит воздух под типографику, и крупному вблизи там не место. Глубину
 * ему даёт даль: тот же кусок породы, что валяется под ногами, отнесённый на сто и триста
 * метров и разросшийся до уступа. Отрисовка от этого не дорожает, гряда идёт тем же
 * инстансом, что и мелочь у ног.
 *
 * Блоки стоят тремя группами с провалами между ними и мельчают вглубь: ровная сыпь по
 * горизонту читается забором, а не рельефом. Бледность приходит сама, маревом: за двести
 * метров оно съедает пятую часть тона, за триста треть, и дальняя группа не спорит с
 * буквами по светлоте.
 *
 * Место берётся у общего плана занятости, поэтому поле пирамид расходится с грядой, а не
 * прорастает сквозь неё.
 */
const RIDGE = {
  sink: 0.22,
  tilt: 0.12,
  drift: 25,
  blocks: [
    [-80, -30, 12], [-96, -23, 8], [-89, -5, 6],
    [-131, -84, 20], [-156, -74, 14], [-147, -44, 10],
    [-197, -115, 26], [-207, -79, 17],
  ],
};

/** Мелкие фигурки, летящие в вихре: те же сфинксы, только величиной с ладонь. */
const FLYING_FIGURE = 1.1;

/**
 * Костры вдоль дороги: снаружи рядов, через станцию.
 *
 * Снаружи потому, что между рядами ходят, через станцию потому, что огонь у каждой фигуры
 * читается иллюминацией, а не стоянкой. Места приходят от той же аллеи, что ставит
 * сфинксов, поэтому подвинутый ряд уводит костры за собой.
 */
const AVENUE_FIRE = { every: 2, outward: 3.8, scale: 0.95 };

/** План очагов: аллея, подножия монументов и подножия готовых фигур. */
function planHearths() {
  const alongRoad = COLONNADE.stations
    .filter((unused, index) => index % AVENUE_FIRE.every === 0)
    .flatMap((z) => COLONNADE.rows.map((x) => ({
      x: x + Math.sign(x) * AVENUE_FIRE.outward,
      z,
      scale: AVENUE_FIRE.scale,
    })));
  const atFeet = LANDMARKS.filter((spot) => spot.fire).map(footHearth);
  return [...alongRoad, ...atFeet, ...RELIC_FIRES];
}

/**
 * Насколько широко песок наметает к подножию: доля роста вещи с потолком в метрах.
 *
 * Наносы положены только большому: у стелы в четыре метра занос читается блином рядом с
 * ней, а не заносом, потому что песок ровно такого же цвета и лежит на ровном месте.
 */
const ANCHOR = { share: 0.11, cap: 2.4, from: 9 };

/**
 * Материал монумента.
 *
 * По умолчанию берётся камень набора вещей: тона у пропсов запечены в вершинный цвет, и
 * свой материал их стёр бы. Гранит навязывается только богам, потому что тёмный силуэт в
 * выжженном кадре это работа палитры сцены, а не набора.
 */
function pickStone(world, name) {
  if (name === 'prop') return propMaterial(world.rng);
  const material = world.materials[name];
  if (!material) throw new Error(`AKHET: нет материала «${name}» для монумента`);
  return material;
}

/**
 * Один монумент: геометрия из `props.js`, материал сцены, посадка в песок.
 *
 * Место выдаёт общий план занятости, а круг под вещь меряется по собранной геометрии, а не
 * по задуманной высоте: у пирамиды основание шире её роста, и радиус, взятый на глаз, врал
 * бы на десятки метров.
 *
 * Упавшее кладётся на бок поворотом вокруг Z: обелиск, лежащий в песке, это тот же
 * обелиск, и второй геометрии он не требует.
 */
function placeLandmark(spot, world) {
  const { rng, dunes, plan } = world;
  const geometry = propGeometry(spot.prop, { rng, height: spot.height });
  geometry.computeBoundingBox();
  const span = geometry.boundingBox.getSize(new THREE.Vector3());
  const stand = plan.place({
    x: spot.x,
    z: spot.z,
    radius: planRadius(span.x, span.z),
    drift: spot.drift ?? 0,
  });

  const mesh = new THREE.Mesh(geometry, pickStone(world, spot.stone));
  const ground = dunes.heightAt(stand.x, stand.z);
  mesh.rotation.y = spot.turn;
  if (spot.fallen) {
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(stand.x, ground + spot.height * 0.06, stand.z);
    mesh.rotation.x = spot.fallen;
  } else {
    mesh.position.set(stand.x, ground - spot.height * (spot.sink ?? 0), stand.z);
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Лестница к воротам.
 *
 * Метры берутся из `DOOR`, потому что по ним же обвязка ставит коллайдер порога. Верхний
 * уступ шире нижнего наоборот: песок наметает к подножию, и широкий низ читается заносом.
 */
function buildStairs(materials) {
  const parts = [];
  const front = HALL.endZ + DOOR.thresholdDepth;
  for (let step = 0; step < STAIRS.steps; step += 1) {
    const height = DOOR.thresholdHeight * ((step + 1) / STAIRS.steps);
    const width = DOOR.thresholdHalf * 2 + step * 1.6;
    const depth = DOOR.thresholdDepth + (STAIRS.steps - step) * STAIRS.run;
    parts.push(stoneBox(width, height, depth)
      .translate(0, height / 2, front - depth / 2 + STAIRS.run * step));
  }
  const mesh = new THREE.Mesh(mergeGeometries(parts), materials.limestone);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Аллея сфинксов: двенадцать фигур на местах из `planColumns`.
 *
 * Расстановка общая с коллайдерами, а сид меняет только просадку и перекос: чем дальше
 * от ворот, тем глубже фигура ушла в песок, и ряд читается заброшенным, а не парадным.
 */
function buildAvenue({ rng, materials, dunes }) {
  const spots = planColumns();
  const figure = propGeometry('sphinx', { rng, height: COLONNADE.bodyHeight });
  const plinth = stoneBox(...COLONNADE.plinth);

  const sunk = spots.map((spot, index) => {
    const away = index / (spots.length - 1);
    return {
      ...spot,
      ground: dunes.heightAt(spot.x, spot.z),
      sink: AVENUE.sink[0] + (AVENUE.sink[1] - AVENUE.sink[0]) * away * rng(),
      tilt: between(rng, -AVENUE.tilt, AVENUE.tilt),
      turn: between(rng, -AVENUE.turn, AVENUE.turn),
    };
  });

  const place = (draft, index) => {
    const spot = sunk[index];
    const inward = spot.x > 0 ? -Math.PI / 2 : Math.PI / 2;
    draft.position.set(spot.x, spot.ground - spot.sink * COLONNADE.bodyHeight, spot.z);
    draft.rotation.set(spot.tilt, inward + spot.turn, spot.tilt * 0.6);
  };

  const stones = [propMaterial(rng), materials.worn];
  return [figure, plinth.translate(0, -COLONNADE.plinth[1] / 2, 0)].map((geometry, index) => {
    const mesh = buildInstanced(geometry, stones[index], sunk.length, place);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  });
}

/**
 * Обломки: то, что вихрь уже выбросил, то, что осыпалось само, и гряда у горизонта.
 *
 * Поля разной плотности вокруг воронки, ворот и ближнего плана. Половина ушла в песок:
 * камень, лежащий на поверхности целиком, выглядит вываленным минуту назад. Гряда идёт тем
 * же куском породы в другом масштабе и сидит в песке мельче: уступу положено стоять
 * стеной, а не лежать боком.
 */
function buildScatter({ rng, dunes, plan }) {
  const chunk = propGeometry('rubble', { rng, height: 1 });
  const pieces = [];
  for (const field of SCATTER.fields) {
    const count = Math.round(SCATTER.count * field.share);
    for (let index = 0; index < count; index += 1) {
      const turn = rng() * TAU;
      const away = field.radius * Math.sqrt(rng());
      const x = field.x + Math.cos(turn) * away;
      const z = field.z + Math.sin(turn) * away;
      pieces.push({
        x,
        z,
        y: dunes.heightAt(x, z),
        size: between(rng, ...SCATTER.size),
        turn: rng() * TAU,
        tilt: between(rng, -0.4, 0.4),
        sink: SCATTER.sink,
      });
    }
  }

  for (const [x, z, size] of RIDGE.blocks) {
    const stand = plan.place({
      x,
      z,
      radius: planRadius(size, size),
      drift: RIDGE.drift,
      skippable: true,
    });
    if (!stand) continue;
    pieces.push({
      x: stand.x,
      z: stand.z,
      y: dunes.heightAt(stand.x, stand.z),
      size,
      turn: rng() * TAU,
      tilt: between(rng, -RIDGE.tilt, RIDGE.tilt),
      sink: RIDGE.sink,
    });
  }

  const mesh = buildInstanced(chunk, propMaterial(rng), pieces.length, (draft, index) => {
    const piece = pieces[index];
    draft.position.set(piece.x, piece.y - piece.size * piece.sink, piece.z);
    draft.rotation.set(piece.tilt, piece.turn, piece.tilt * 0.7);
    draft.scale.setScalar(piece.size);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Мир целиком: песок, монументы, воздух и вихрь.
 *
 * Сид меняет дюны, просадку фигур, разброс обломков и повадки вихря, но не трогает ни
 * дороги, ни ворот: по ним ставит коллайдеры обвязка, и они обязаны совпадать.
 *
 * Место на песке выдаёт один план занятости на всю сцену. Первым в него встаёт коридор от
 * афишной камеры до типографики, потом аллея, потом монументы, и только после этого,
 * отдельным заездом по загрузке, готовые модели: расстановка синхронная, и к приезду
 * моделей план заполнен целиком.
 */
export function createArchitecture({ rng }) {
  const group = new THREE.Group();
  const maps = createStoneMaps(rng);
  const materials = createMaterials(maps);
  const dunes = createDunes(rng);
  const plan = createSitePlan();
  const world = { rng, materials, dunes, plan };

  for (const circle of planCorridor()) plan.place(circle);
  for (const column of planColumns()) plan.place(column);

  const sky = createSky(rng);
  group.add(sky.group);

  group.add(createSand({ rng, material: materials.sand, dunes }));
  group.add(createRipples({ rng, material: materials.sand, dunes }));
  group.add(createTracks({ rng, material: materials.drift, dunes }));

  group.add(buildStairs(materials));
  group.add(...buildAvenue(world));
  group.add(buildScatter(world));

  const anchors = [];
  for (const spot of LANDMARKS) {
    const mesh = placeLandmark(spot, world);
    group.add(mesh);
    if (mesh.position.z > HALL.endZ && spot.height >= ANCHOR.from) {
      anchors.push({
        x: mesh.position.x,
        z: mesh.position.z,
        radius: Math.min(ANCHOR.cap, spot.height * ANCHOR.share),
      });
    }
  }

  group.add(createRelics({ dunes, materials, plan }));
  group.add(createDrifts({ rng, material: materials.drift, dunes, anchors }));

  const fire = createFire({
    rng,
    dunes,
    material: materials.worn,
    hearths: planHearths(),
  });
  group.add(fire.group);

  const vortex = createVortex({
    rng,
    materials,
    figures: propGeometry('sphinx', { rng, height: FLYING_FIGURE }),
  });
  group.add(vortex.group);

  function update(elapsed) {
    sky.update(elapsed);
    fire.update(elapsed);
    vortex.update(elapsed);
  }

  return { group, update, bounds: BOUNDS };
}
