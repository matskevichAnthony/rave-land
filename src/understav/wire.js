import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './palette.js';

/**
 * Колючая проволока афиши: готовая модель, а не сборка из конусов.
 *
 * Своя колючка из примитивов читается орнаментом: одинаковый шаг, одинаковый шип и ни одной
 * случайной кривизны, которой живёт настоящий моток. В файле прядь длиной десять единиц, и
 * целиком она в кадр не годится: шип в ней сотая часть длины, то есть на ширину афиши он
 * выходит с волосок. Поэтому сцена берёт короткий кусок пряди и повторяет его лентой вдоль
 * прогона. Крупность колючки задаётся длиной куска в метрах, частота шипов — ею же.
 */

const MODEL_URL = 'assets/models/barbed-wire.glb';
// В файле четыре узла, и два из них вырожденные обрезки по два треугольника.
const MIN_USEFUL_TRIANGLES = 100;
// Длина куска в единицах файла и число проб при поиске: прядь провисает и путается петлями,
// а над лайнапом нужен ровный кусок, иначе петля ляжет поперёк имён.
const SLICE_LENGTH = 0.9;
const SLICE_PROBES = 64;
// Допуск на кривизну в долях длины куска: выше этого прядь уже не идёт, а вьётся петлёй.
const SLICE_WOBBLE = 0.09;
// Прядь в файле не натянута, она мотается: волна в ней впятеро крупнее шипа, и кусок,
// растянутый на ширину афиши, шёл бы метрами поперёк строк. Прижимать всё подряд нельзя,
// вместе с волной сядут и шипы, поэтому вычитается только осевая линия куска: волна уходит,
// шип остаётся. Ноль оставит прядь как есть, единица вытянет её в струну.
const WAVE_PULL = 0.88;
// Осевая считается по клеткам вдоль куска: клетка длиннее шипа, иначе средняя поедет за ним.
const WAVE_CELLS = 20;

// Прут тёмно-серый: он читается на огне и на свете из портала, а не собственным цветом, но в
// чистую черноту уходить ему нельзя, иначе от него остаётся дырка. Блик узкий и яркий: без
// него круглый прут в тёмном коридоре плоский, потому что объём железке даёт не толщина, а
// светлая полоса вдоль неё. Бегущее красное поверх этого держит движение.
const WIRE_COLOR = new THREE.Color(PALETTE.iron).lerp(new THREE.Color(PALETTE.concrete), 0.7);
const WIRE_METALNESS = 0.6;
const WIRE_ROUGHNESS = 0.38;

// Прут раздувается по нормали на постоянную величину в долях длины куска. Толщина ему нужна
// своя, а не общим масштабом: масштаб вместе с прутом тянет и шипы, а они и так с полметра.
// Прибавка ко всему сечению одинаковая, поэтому тонкий прут толстеет вдвое, а шип прибавляет
// десятую часть.
const WIRE_SWELL = 0.022;
// Прогон слегка проворачивается вокруг своей оси: два одинаково лежащих прута читаются линейкой.
const WIRE_ROLL = 0.35;

// Прядь в файле нарисована для крупного плана: четыре тысячи треугольников на пять шипов, и
// лентой на пять прогонов это больше сотни тысяч на фоновую железку. Поэтому кусок
// прорежается: в коридоре он виден силуэтом с двадцати метров, и половина рёбер в нём не
// читается. Доля оставленных вершин; единица оставит кусок как есть.
const SLICE_KEEP = 0.5;

// Длина куска в метрах: она же шаг шипов. Один кусок на весь прогон растягивает шип до метра
// и оставляет между шипами голый прут, то есть орнамент вместо колючки.
const TILE_METRES = 3;
// Сечение поднято против натурального: прядь в натуральную величину с двадцати метров
// коридора остаётся царапиной на стекле, и от колючки в кадре не остаётся ничего.
const TILE_GAUGE = 2.4;

/**
 * Ход ленты: прядь едет вдоль прогона, сам прогон стоит.
 *
 * Концы прогона держат стены коридора, и двигать их нельзя. Едут куски: ушедший за дальний
 * край встаёт в начало, а прогон кратен куску, поэтому подмена приходится на стык двух
 * одинаковых кусков и в кадре не видна. Метров в секунду.
 */
const TRAVEL_SPEED = 1.2;

/**
 * Ток по проволоке: рисунок едет вдоль прогона, сам прогон стоит.
 *
 * Прядь натянута между стенами коридора, и двигать её нельзя: сдвинутый конец повиснет в
 * воздухе. Движение поэтому живёт в шейдере, как бегущая по пруту полоса свечения. Метрика
 * рисунка снимается с координаты вдоль прогона уже после матрицы инстанса, а не с локальной
 * геометрии: иначе на прогоне вдвое шире полосы вышли бы вдвое длиннее, и пять прогонов
 * поехали бы вразнобой. `cell` это длина полосы в метрах, `speed` полос в секунду.
 */
const FLOW = { cell: 1.7, speed: 0.45, sharpness: 7 };
// Между полосами прут не гаснет в ноль: слабая подсветка держит силуэт в дальнем конце.
const FLOW_COOL = new THREE.Color(PALETTE.bone).multiplyScalar(0.08);
const FLOW_HOT = new THREE.Color(PALETTE.blood).multiplyScalar(0.32);

let slicePromise = null;

/** Треугольники меша в мировых координатах файла, развёрнутые по вершинам. */
function trianglesOf(mesh) {
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  return flat;
}

/**
 * Где резать прядь: там, где она идёт прямо и густо.
 *
 * Прямизна меряется отклонением от своей же прямой, а не разбросом по высоте: кусок бывает
 * наклонным, и наклон потом выравнивается поворотом. Разброс наказал бы как раз шипы, из-за
 * которых кусок и берут, и выбрал бы голый участок пряди.
 */
function pickWindow(position) {
  let low = Infinity;
  let high = -Infinity;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    low = Math.min(low, position.getX(vertex));
    high = Math.max(high, position.getX(vertex));
  }
  const travel = Math.max(high - low - SLICE_LENGTH, 0);
  const probes = [];
  for (let probe = 0; probe <= SLICE_PROBES; probe += 1) {
    const from = low + (travel * probe) / SLICE_PROBES;
    probes.push({ from, ...windowStats(position, from) });
  }
  const whole = probes.filter((item) => item.count > 0);
  if (whole.length === 0) throw new Error(`${MODEL_URL}: в пряди нет ни одного целого куска`);
  const straight = whole.filter((item) => item.wobble <= SLICE_LENGTH * SLICE_WOBBLE);
  const pool = straight.length > 0 ? straight : whole;
  // Гуще значит колючее: шипы это и есть та геометрия, которой в куске становится больше.
  return pool.reduce((best, item) => (item.count > best.count ? item : best));
}

/** Сколько целых треугольников в окне и насколько сильно они уходят от своей прямой. */
function windowStats(position, from) {
  const to = from + SLICE_LENGTH;
  const line = { n: 0, x: 0, y: 0, xx: 0, xy: 0 };
  let count = 0;
  for (let corner = 0; corner < position.count; corner += 3) {
    if (!wholeTriangleInside(position, corner, from, to)) continue;
    count += 1;
    for (let step = 0; step < 3; step += 1) {
      const x = position.getX(corner + step);
      const y = position.getY(corner + step);
      line.n += 1;
      line.x += x;
      line.y += y;
      line.xx += x * x;
      line.xy += x * y;
    }
  }
  if (count === 0) return { count, wobble: Infinity };

  const spread = line.xx - (line.x * line.x) / line.n;
  const slope = spread > 0 ? (line.xy - (line.x * line.y) / line.n) / spread : 0;
  const level = (line.y - slope * line.x) / line.n;
  let wobble = 0;
  for (let corner = 0; corner < position.count; corner += 3) {
    if (!wholeTriangleInside(position, corner, from, to)) continue;
    for (let step = 0; step < 3; step += 1) {
      const x = position.getX(corner + step);
      wobble = Math.max(wobble, Math.abs(position.getY(corner + step) - (slope * x + level)));
    }
  }
  return { count, wobble };
}

function wholeTriangleInside(position, corner, from, to) {
  for (let step = 0; step < 3; step += 1) {
    const x = position.getX(corner + step);
    if (x < from || x > to) return false;
  }
  return true;
}

/** Осевая линия куска по одной поперечной оси: среднее по клеткам, приглаженное соседями. */
function centreLine(positions, from, axis) {
  const sum = new Array(WAVE_CELLS).fill(0);
  const seen = new Array(WAVE_CELLS).fill(0);
  for (let at = 0; at < positions.length; at += 3) {
    const cell = cellOf(positions[at], from);
    sum[cell] += positions[at + axis];
    seen[cell] += 1;
  }
  const middle = sum.map((total, cell) => (seen[cell] > 0 ? total / seen[cell] : null));
  // У крайних клеток соседа с одной стороны нет: без отсева в среднее уходит `undefined`,
  // и вся прядь становится NaN.
  return middle.map((value, cell) => {
    const around = [middle[cell - 1], value, middle[cell + 1]].filter(Number.isFinite);
    return around.length > 0 ? around.reduce((a, b) => a + b, 0) / around.length : 0;
  });
}

function cellOf(x, from) {
  const cell = Math.floor(((x - from) / SLICE_LENGTH) * WAVE_CELLS);
  return Math.min(Math.max(cell, 0), WAVE_CELLS - 1);
}

/**
 * Высота осевой в точке: между центрами клеток она тянется прямой.
 *
 * Без этого осевая идёт ступеньками, и на каждой границе клеток прядь получает излом. В
 * кадре это читается не проволокой, а сломанной ломаной поперёк афиши.
 */
function centreAt(middle, x, from) {
  const along = ((x - from) / SLICE_LENGTH) * WAVE_CELLS - 0.5;
  const low = Math.floor(along);
  const near = middle[Math.min(Math.max(low, 0), WAVE_CELLS - 1)];
  const next = middle[Math.min(Math.max(low + 1, 0), WAVE_CELLS - 1)];
  return near + (next - near) * Math.min(Math.max(along - low, 0), 1);
}

/**
 * Волна вычитается, шипы остаются: у вершины отнимается только осевая под ней.
 *
 * Обе поперечные оси, а не одна высота: прядь мотается и вбок, и кусок, выпрямленный только
 * по высоте, уходит поперёк коридора петлёй в собственную длину. Повторённый лентой, он
 * читается не проволокой, а гирляндой одинаковых петель.
 */
function pullStraight(positions, from) {
  for (const axis of [1, 2]) {
    const middle = centreLine(positions, from, axis);
    for (let at = 0; at < positions.length; at += 3) {
      positions[at + axis] -= centreAt(middle, positions[at], from) * WAVE_PULL;
    }
  }
}

/** Кусок пряди: целые треугольники окна, начало координат в его середине, длина в единицу. */
function sliceStrand(flat) {
  const position = flat.getAttribute('position');
  const normal = flat.getAttribute('normal');
  const from = pickWindow(position).from;
  const to = from + SLICE_LENGTH;

  const positions = [];
  const normals = [];
  for (let corner = 0; corner < position.count; corner += 3) {
    if (!wholeTriangleInside(position, corner, from, to)) continue;
    for (let step = 0; step < 3; step += 1) {
      const vertex = corner + step;
      positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      normals.push(normal.getX(vertex), normal.getY(vertex), normal.getZ(vertex));
    }
  }
  if (positions.length === 0) throw new Error(`${MODEL_URL}: в куске пряди не осталось треугольников`);
  pullStraight(positions, from);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  geometry.translate(
    -(box.min.x + box.max.x) / 2,
    -(box.min.y + box.max.y) / 2,
    -(box.min.z + box.max.z) / 2,
  );
  geometry.scale(1 / SLICE_LENGTH, 1 / SLICE_LENGTH, 1 / SLICE_LENGTH);
  return thinOut(geometry);
}

/**
 * Прореженный кусок: рёбер вдвое меньше, силуэт тот же.
 *
 * Нормали после схлопывания рёбер пересчитываются: прежние остались от вершин, которых уже
 * нет, и прут с ними идёт пятнами. Считать их заново дешевле, чем тащить исходную сетку.
 */
function thinOut(geometry) {
  // Кусок вырезан по треугольникам, и одна вершина в нём лежит по копии на каждый угол.
  // Считать долю от такой сетки нельзя: прореживатель меряет вершины уже сшитыми, и доля от
  // несшитых просит убрать больше вершин, чем в ней есть, то есть весь кусок целиком.
  const sewn = mergeVertices(geometry);
  const vertices = sewn.getAttribute('position').count;
  const thin = new SimplifyModifier().modify(sewn, Math.round(vertices * (1 - SLICE_KEEP)));
  geometry.dispose();
  sewn.dispose();
  thin.computeVertexNormals();
  return thin;
}

async function loadSlice() {
  const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
  gltf.scene.updateMatrixWorld(true);
  const strands = [];
  gltf.scene.traverse((node) => {
    if (!node.isMesh) return;
    const triangles = (node.geometry.index ?? node.geometry.getAttribute('position')).count / 3;
    if (triangles >= MIN_USEFUL_TRIANGLES) strands.push({ node, triangles });
  });
  if (strands.length === 0) throw new Error(`${MODEL_URL} без пряди проволоки`);

  // Прядей в файле две, и лёгкая ничем не хуже: в кадре они отличаются только числом петель.
  const lightest = strands.reduce((best, item) => (item.triangles < best.triangles ? item : best));
  const flat = trianglesOf(lightest.node);
  const slice = sliceStrand(flat);
  flat.dispose();
  return slice;
}

/** Модель тянется по сети один раз на страницу, сколько бы прогонов её ни просило. */
function strandSlice() {
  if (!slicePromise) slicePromise = loadSlice();
  return slicePromise;
}

/**
 * Металл пряди с бегущей вдоль неё полосой свечения.
 *
 * Правится штатный `MeshStandardMaterial`, а не пишется свой шейдер: колючке нужен весь свет
 * зала, а полоса это одно слагаемое к собственному свечению. `flow` это тот же объект-юниформ,
 * который потом двигает `update`.
 */
function flowingMaterial(flow) {
  const material = new THREE.MeshStandardMaterial({
    color: WIRE_COLOR,
    metalness: WIRE_METALNESS,
    roughness: WIRE_ROUGHNESS,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.flowTime = flow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vAlong;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  transformed += normal * ${WIRE_SWELL.toFixed(4)};
  vAlong = (instanceMatrix * vec4(transformed, 1.0)).x;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float flowTime;\nvarying float vAlong;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  float flowPhase = vAlong / ${FLOW.cell.toFixed(3)} - flowTime * ${FLOW.speed.toFixed(3)};
  float flowWave = pow(0.5 + 0.5 * sin(flowPhase * ${(Math.PI * 2).toFixed(6)}), ${FLOW.sharpness.toFixed(1)});
  totalEmissiveRadiance += mix(
    vec3(${FLOW_COOL.r.toFixed(4)}, ${FLOW_COOL.g.toFixed(4)}, ${FLOW_COOL.b.toFixed(4)}),
    vec3(${FLOW_HOT.r.toFixed(4)}, ${FLOW_HOT.g.toFixed(4)}, ${FLOW_HOT.b.toFixed(4)}),
    flowWave
  );`);
  };
  return material;
}

/**
 * Куски одного прогона: сколько их влезло по длине, плюс один на стык.
 *
 * Длина куска подгоняется так, чтобы прогон делился нацело: лента едет по кругу, и остаток
 * в полкуска дал бы на подмене прыжок. Лишний кусок нужен затем, что круг где-то приходится
 * разрезать: кусок, дошедший до края, встаёт в начало целиком, и без запаса на его месте на
 * несколько секунд оставалась бы дыра. С запасом дыра приходится на сам запас, то есть за
 * стену: лента длиннее прогона на кусок, и на кусок же она за край свисает.
 *
 * Поворот у всего прогона один: куски это одна прядь, а не набор обрезков.
 */
function planTiles(run, index, rng) {
  const span = run.width;
  const step = span / Math.max(1, Math.round(span / TILE_METRES));
  const belt = span + step;
  const spin = new THREE.Euler(rng.range(-1, 1) * WIRE_ROLL, index % 2 === 1 ? Math.PI : 0, 0);
  const turn = new THREE.Quaternion().setFromEuler(spin);
  const size = new THREE.Vector3(step, step * TILE_GAUGE, step * TILE_GAUGE);
  const from = (run.x ?? 0) - span / 2 - step / 2;
  // Соседние прогоны едут врозь: одинаковое направление у всех пяти читается конвейером.
  const heading = index % 2 === 1 ? -1 : 1;
  return Array.from({ length: Math.round(belt / step) }, (unused, tile) => ({
    turn,
    size,
    y: run.y,
    z: run.z,
    from,
    belt,
    at: (tile + 0.5) * step,
    heading,
  }));
}

/**
 * Прогоны проволоки одним инстансом.
 *
 * Прогон это `{ x, y, z, width }` в метрах зала: место и ширина. На него ложится лента из
 * кусков пряди, а через один прогон переворачивается, чтобы два прогона в одном кадре не
 * читались копией друг друга. Наружу идут меш и `update(elapsed)`: и свечение, и ход ленты
 * живут по времени сцены, своего времени у модуля нет.
 */
export async function createBarbedWire({ runs, rng }) {
  const geometry = await strandSlice();
  const flow = { value: 0 };
  const material = flowingMaterial(flow);
  const tiles = runs.flatMap((run, index) => planTiles(run, index, rng));
  const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
  // Тень прута в чёрном зале не видно, а карту теней она стоит второго прохода геометрии.
  mesh.castShadow = false;

  const place = new THREE.Matrix4();
  const at = new THREE.Vector3();

  function travel(elapsed) {
    tiles.forEach((tile, index) => {
      const drift = tile.at + elapsed * TRAVEL_SPEED * tile.heading;
      at.set(tile.from + ((drift % tile.belt) + tile.belt) % tile.belt, tile.y, tile.z);
      mesh.setMatrixAt(index, place.compose(at, tile.turn, tile.size));
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  travel(0);

  return {
    mesh,
    update(elapsed) {
      flow.value = elapsed;
      travel(elapsed);
    },
  };
}
