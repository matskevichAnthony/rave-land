/**
 * Готовые египетские модели поверх процедурной расстановки.
 *
 * Процедурные вещи держат силуэт сцены, а эти дают то, чего тёсаными блоками не получить:
 * пластику. Все крупные фигуры кадра теперь музейные сканы: процедурный бог пересобирается
 * на каждом сиде и вблизи читается кубизмом, поэтому в `props.js` от фигур людей осталась
 * только аллея сфинксов, где работает силуэт, а не поверхность.
 *
 * Сканов в сцене считанные штуки и размножать их нельзя: каждый стоит около пяти тысяч
 * треугольников. Одна фигура на роль в кадре, а поле у горизонта держат ступенчатые
 * пирамиды по три с половиной сотни треугольников.
 *
 * Сканы приходят без материала, поэтому камень им даёт сцена: известняк и гранит из
 * `stone.js`. Модель с собственной раскраской (Анубис, верблюд, пальма) остаётся при своей
 * и ставится копиями, а всё, чему навязан камень сцены, сливается в одну геометрию и
 * ставится инстансами: шестнадцать копий стоят одного вызова отрисовки, а не шестнадцати.
 *
 * Место каждой копии выдаёт общий план занятости из `hall.js`, тот же, по которому
 * расставлены процедурные монументы. Пока планов было два, ступенчатая пирамида вставала
 * внутрь процедурной.
 *
 * Загрузка асинхронная, а сборка мира синхронная, поэтому модели приезжают в уже готовую
 * группу отдельным заездом. К этому моменту процедурная расстановка план уже заполнила, и
 * готовые вещи расходятся по свободному песку.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadModelData } from '../objects/gltf.js';
import { buildInstanced } from '../procedural/instancing.js';
import { footHearth } from './fire.js';
import { projectUv } from './masonry.js';
import { planRadius } from './hall.js';

const EGYPT = 'assets/models/egypt/';

/** Зерно камня в метрах: у сканов нет развёртки, и её проецируем сами. */
const SCAN_TILE = 3.2;

/** На сколько метров вещь вправе отойти от своего места, если оно занято. */
const DRIFT = { near: 3, desert: 8, field: 60 };

/**
 * Расстановка готовых моделей.
 *
 * `height` это рост в метрах: габарит внутри файлов не метрический, и каждая модель
 * подгоняется по своей коробке. `stone` навязывает камень сцены и включает инстансы, без
 * него модель ставится копией со своим материалом. `fire` помечает того, у чьих ног горит:
 * очаги собирает `fire.js`.
 *
 * Колосс Рамсеса стоит справа от оси взгляда на ближней половине площадки: в двадцати
 * метрах ростом он занимает половину высоты кадра и работает главной фигурой афиши.
 * Второй, поменьше, отвечает ему в глубине и держит у ног огонь. Сехмет и Рамсес отвечают
 * им слева и в глубине, а принцесса из Амарны стоит в полосе типографики и держит вершину
 * ниже букв: десять метров против четырнадцати, с которых начинается коробка надписи.
 * Бастет мала намеренно: на ближнем плане слева она даёт мерку роста.
 *
 * Анубис стоит в шестидесяти метрах от афишной точки и в двадцать два метра ростом
 * занимает половину высоты кадра. Верблюды и пальмы уехали к дюнам: это мерка роста, а не
 * герои кадра.
 */
const RELICS = [
  { model: 'colossus-ramesses.glb', stone: 'worn', height: 20, x: 14, z: -19, turn: -0.55 },
  {
    model: 'colossus-ramesses.glb', stone: 'worn', height: 16.5, x: 29, z: -28,
    turn: -1.1, sink: 0.12, fire: true,
  },
  {
    model: 'sekhmet.glb', stone: 'granite', height: 13, x: -24, z: -26,
    turn: 0.9, sink: 0.12, fire: true,
  },
  {
    model: 'amarna-princess.glb', stone: 'granite', height: 10, x: -16, z: -21,
    turn: 0.05, sink: 0.1,
  },
  {
    model: 'ramesses-bust.glb', stone: 'granite', height: 9.5, x: 20, z: -34,
    turn: -0.08, sink: 0.06, fire: true,
  },
  { model: 'bastet.glb', stone: 'granite', height: 7, x: -12.5, z: -3, turn: 1.6, sink: 0.04 },

  { model: 'anubis-statue.glb', height: 22, x: 23, z: -10, turn: -0.6, fire: true },
  { model: 'anubis-statue.glb', height: 13, x: -21, z: -13, turn: 0.7, sink: 0.15, fire: true },

  { model: 'stone-statue.glb', stone: 'limestone', height: 6, x: 14, z: -2, turn: -1.6 },
  {
    model: 'stone-statue.glb', stone: 'limestone', height: 5.5, x: -14.5, z: -8,
    turn: 1.6, sink: 0.1,
  },
  {
    model: 'stone-statue.glb', stone: 'limestone', height: 6.5, x: 11, z: -27,
    turn: -1.4, sink: 0.12,
  },

  // Верблюд стоит почти восемь тысяч треугольников, поэтому их двое, а не стадо.
  { model: 'camel.glb', height: 2.3, x: -33, z: -37, turn: -0.9, drift: DRIFT.desert },
  { model: 'camel.glb', height: 2.2, x: -29.5, z: -41.5, turn: -1.3, drift: DRIFT.desert },

  { model: 'palm.glb', height: 7.4, x: -26, z: -30, turn: 0.4, drift: DRIFT.desert },
  { model: 'palm.glb', height: 6.2, x: -29.5, z: -34, turn: 2.1, drift: DRIFT.desert },
  { model: 'palm.glb', height: 8.1, x: -23, z: -35.5, turn: 4, drift: DRIFT.desert },
];

/** Очаги у ног готовых фигур: расстановку помечает та же таблица, что их ставит. */
export const RELIC_FIRES = RELICS.filter((relic) => relic.fire).map(footHearth);

const PYRAMID = 'step-pyramid.glb';

/**
 * Поле ступенчатых пирамид: ближние мельче, дальние выше, ни одна не стоит на оси кадра.
 *
 * Места разведены по кругам занятости вместе с процедурными пирамидами: у стометровой
 * пирамиды основание шире её высоты, и полтораста метров пустого песка вокруг неё это не
 * щедрость, а её собственный габарит. Поле поредело против прежнего по той же причине:
 * шестнадцать пирамид в этот песок помещались только внахлёст.
 */
const NECROPOLIS = [
  [-215, -108, 38], [-160, -128, 15], [-286, -162, 26], [-306, -319, 30],
  [-59, -223, 20], [-2, -172, 18], [1, -224, 24], [62, -212, 22],
  [178, -340, 28], [232, -160, 24], [252, -334, 34], [-83, -357, 30],
];

/** Поворот каждой следующей пирамиды: шаг в радианах, поле не должно читаться гребёнкой. */
const PYRAMID_TURN = 0.83;

const FIELD = NECROPOLIS.map(([x, z, height], index) => ({
  model: PYRAMID,
  stone: 'limestone',
  height,
  x,
  z,
  turn: index * PYRAMID_TURN,
  sink: 0.04,
  drift: DRIFT.field,
  skippable: true,
}));

/**
 * Слитая геометрия модели: узлы схлопнуты в свои координаты, лишние атрибуты сняты.
 *
 * Развёртку и вершинный цвет модели уносим вместе с её материалом: камень сцене даёт
 * `stone.js`, а зерно ложится собственной проекцией.
 */
function flatten(scene) {
  scene.updateMatrixWorld(true);
  const parts = [];
  scene.traverse((node) => {
    if (!node.isMesh) return;
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
    }
    parts.push(geometry);
  });
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  if (!merged) throw new Error('AKHET: части модели не сливаются в одну геометрию');
  return merged;
}

/**
 * Геометрия ростом в единицу, основанием на нуле и центром плана в оси.
 *
 * Инстанс масштабируется собственным ростом, поэтому нормировать надо один раз на модель.
 * Зерно проецируется под самую высокую копию: развёртка у инстансов общая, и растягивать
 * её на нижних заметнее, чем сжимать на верхних.
 */
function unitise(geometry, tallest) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const centre = box.getCenter(new THREE.Vector3());
  const height = box.max.y - box.min.y;
  geometry.translate(-centre.x, -box.min.y, -centre.z);
  geometry.scale(1 / height, 1 / height, 1 / height);
  return projectUv(geometry, SCAN_TILE / tallest);
}

/** Место копии по общему плану: круг считается по габариту модели в её росте. */
function stand(spot, size, plan) {
  const scale = spot.height / size.y;
  return plan.place({
    x: spot.x,
    z: spot.z,
    radius: planRadius(size.x * scale, size.z * scale),
    drift: spot.drift ?? DRIFT.near,
    skippable: spot.skippable ?? false,
  });
}

/** Принятые планом копии: место, земля под ним и всё, что нужно для посадки. */
function survey(spots, size, { plan, dunes }) {
  const taken = [];
  for (const spot of spots) {
    const place = stand(spot, size, plan);
    if (!place) continue;
    taken.push({
      ...spot,
      ...place,
      y: dunes.heightAt(place.x, place.z) - spot.height * (spot.sink ?? 0),
    });
  }
  return taken;
}

/** Модель со своим материалом: каждая копия отдельным узлом. */
function cloneCopies(scene, box, taken) {
  return taken.map((spot) => {
    const model = scene.clone(true);
    const scale = spot.height / (box.max.y - box.min.y);
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
    const pivot = new THREE.Group();
    pivot.add(model);
    pivot.position.set(spot.x, spot.y, spot.z);
    pivot.rotation.y = spot.turn;
    return pivot;
  });
}

/** Модель с камнем сцены: все копии одним инстансом. */
function instancedCopies(scene, material, taken) {
  const tallest = Math.max(...taken.map((spot) => spot.height));
  const geometry = unitise(flatten(scene), tallest);
  const mesh = buildInstanced(geometry, material, taken.length, (draft, index) => {
    const spot = taken[index];
    draft.position.set(spot.x, spot.y, spot.z);
    draft.rotation.y = spot.turn;
    draft.scale.setScalar(spot.height);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return [mesh];
}

function report(source, error) {
  console.error(`AKHET: не загрузилась модель ${source}`, error);
}

/** Копии одной модели: инстансами, если камень навязан сценой, иначе узлами. */
function buildModel(scene, spots, world) {
  const box = new THREE.Box3().setFromObject(scene);
  const taken = survey(spots, box.getSize(new THREE.Vector3()), world);
  if (!taken.length) return [];
  const stone = spots[0].stone;
  if (!stone) return cloneCopies(scene, box, taken);
  const material = world.materials[stone];
  if (!material) throw new Error(`AKHET: нет материала «${stone}» для модели`);
  return instancedCopies(scene, material, taken);
}

export function createRelics({ dunes, materials, plan }) {
  const group = new THREE.Group();
  const wanted = new Map();
  for (const relic of [...RELICS, ...FIELD]) {
    const spots = wanted.get(relic.model) ?? [];
    spots.push(relic);
    wanted.set(relic.model, spots);
  }

  const models = [...wanted.keys()];
  Promise.all(models.map((model) => loadModelData(EGYPT + model)
    .then(({ scene }) => scene)
    .catch((error) => report(model, error))))
    .then((scenes) => {
      scenes.forEach((scene, index) => {
        if (!scene) return;
        group.add(...buildModel(scene, wanted.get(models[index]), { dunes, materials, plan }));
      });
    });

  return group;
}
