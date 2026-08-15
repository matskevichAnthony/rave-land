/**
 * Кладка: тёсаные заготовки, из которых собираются пропсы сцены.
 *
 * Каждая заготовка стоит основанием на нуле и меряется метрами: пропс собирается
 * переносами, а не масштабом узла. Масштаб узла растянул бы вместе с камнем и сколы,
 * и зерно поверхности, и одинаковый скол на десятиметровом колоссе и на плите выдал бы
 * процедурность быстрее любого силуэта.
 *
 * Геометрия неиндексированная и с плоскими нормалями намеренно. Треугольников это не
 * прибавляет, а гранёная поверхность под высоким солнцем и есть то, чем тёсаный камень
 * отличается от гладкого примитива.
 */

import * as THREE from 'three';
import { between } from '../procedural/random.js';

const QUARTER_TURN = Math.PI / 2;
const HALF = 0.5;

/** Углы низа против часовой стрелки, верх повторяет их порядок. */
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];

const HEXAHEDRON = [
  [4, 7, 6], [4, 6, 5],
  [0, 1, 2], [0, 2, 3],
  [3, 2, 6], [3, 6, 7],
  [1, 0, 4], [1, 4, 5],
  [2, 1, 5], [2, 5, 6],
  [0, 3, 7], [0, 7, 4],
];

const WEDGE = [
  [0, 1, 2], [0, 2, 3],
  [3, 2, 4], [2, 1, 4], [1, 0, 4], [0, 3, 4],
];

/** Низ садится на опору, поэтому его углы только приподнимаются, а не проваливаются. */
const FOOT_BITE = 0.4;
const CREST_LIFT = 0.3;
const CREST_DROP = 0.5;

const shade = new THREE.Color();

function facesToGeometry(points, faces) {
  const position = new Float32Array(faces.length * 9);
  for (let face = 0; face < faces.length; face += 1) {
    for (let slot = 0; slot < 3; slot += 1) {
      const point = points[faces[face][slot]];
      const offset = face * 9 + slot * 3;
      position[offset] = point[0];
      position[offset + 1] = point[1];
      position[offset + 2] = point[2];
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(faces.length * 6), 2));
  geometry.computeVertexNormals();
  return geometry;
}

function roughen(points, { jitter, crown, rng }) {
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const top = index >= 4;
    point[0] += between(rng, -jitter, jitter);
    point[2] += between(rng, -jitter, jitter);
    point[1] += top
      ? between(rng, -jitter * CREST_DROP, jitter * CREST_LIFT) - between(rng, 0, crown)
      : between(rng, 0, jitter * FOOT_BITE);
  }
}

/**
 * Тёсаный блок: низ, верх своей ширины и своего смещения, углы разбиты по сиду.
 *
 * Сужение верха это батер, наклон египетской стены; `lean` уводит верх вбок, когда
 * вертикальной должна остаться одна грань, а не обе; `slope` поднимает половину верха,
 * из чего получаются пандусы и скошенные щёки лестниц; `crown` съедает верхние углы,
 * и блок читается обломанным.
 */
export function hewnBlock({
  width,
  depth,
  height,
  topWidth = width,
  topDepth = depth,
  lean = 0,
  leanZ = 0,
  slopeX = 0,
  slopeZ = 0,
  jitter = 0,
  crown = 0,
  rng,
}) {
  const points = [];
  for (const [signX, signZ] of CORNERS) {
    points.push([signX * width * HALF, 0, signZ * depth * HALF]);
  }
  for (const [signX, signZ] of CORNERS) {
    points.push([
      lean + signX * topWidth * HALF,
      height + slopeX * (signX + 1) * HALF + slopeZ * (signZ + 1) * HALF,
      leanZ + signZ * topDepth * HALF,
    ]);
  }
  if (jitter > 0 || crown > 0) roughen(points, { jitter, crown, rng });
  return facesToGeometry(points, HEXAHEDRON);
}

/** Пирамидка: пирамидион обелиска, верхушка большой пирамиды, осколок камня. */
export function pyramidBlock({
  width,
  depth = width,
  height,
  apexX = 0,
  apexZ = 0,
  jitter = 0,
  rng,
}) {
  const points = [];
  for (const [signX, signZ] of CORNERS) {
    points.push([signX * width * HALF, 0, signZ * depth * HALF]);
  }
  points.push([apexX, height, apexZ]);
  if (jitter > 0) roughen(points, { jitter, crown: 0, rng });
  return facesToGeometry(points, WEDGE);
}

function facet(geometry) {
  const flat = geometry.toNonIndexed();
  flat.computeVertexNormals();
  return flat;
}

/**
 * Барабан: круглый вал, валик на ребре пилона, тулово канопа.
 *
 * `open` снимает донья: они стоят десятой части треугольников и не видны ни разу,
 * когда вал уходит в землю и упирается в карниз.
 */
export function drum({ radius, topRadius = radius, height, segments = 8, open = false }) {
  const body = new THREE.CylinderGeometry(topRadius, radius, height, segments, 1, open);
  return facet(body).translate(0, height * HALF, 0);
}

/**
 * Полукруглая крышка: верх стелы, хлеб на жертвенном столе.
 *
 * Плоская грань снизу открыта: она всегда упирается в тело, на которое крышка села,
 * и закрывать её значит платить за невидимое.
 */
export function roundCap({ radius, depth, segments = 7 }) {
  const arc = new THREE.CylinderGeometry(
    radius, radius, depth, segments, 1, false, QUARTER_TURN, Math.PI,
  );
  return facet(arc.rotateX(QUARTER_TURN));
}

/** Цвет камня уходит в вершины: набор живёт на одном материале и на одном инстансе. */
export function paint(geometry, color) {
  shade.set(color);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    colors[index * 3] = shade.r;
    colors[index * 3 + 1] = shade.g;
    colors[index * 3 + 2] = shade.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Развёртка проекцией на ближайшую грань куба, метрами.
 *
 * Развёртки заготовок разъезжаются: у коробки грань размечена от нуля до единицы, у
 * барабана по окружности. Одна проекция поверх собранного пропса даёт зерно одного
 * масштаба и на облицовке пирамиды, и на плече колосса.
 */
export function projectUv(geometry, tile) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = new Float32Array(position.count * 2);
  for (let index = 0; index < position.count; index += 1) {
    const alongX = Math.abs(normal.getX(index));
    const alongY = Math.abs(normal.getY(index));
    const alongZ = Math.abs(normal.getZ(index));
    const flat = alongY >= alongX && alongY >= alongZ;
    const side = !flat && alongX >= alongZ;
    uv[index * 2] = (flat || !side ? position.getX(index) : position.getZ(index)) / tile;
    uv[index * 2 + 1] = (flat ? position.getZ(index) : position.getY(index)) / tile;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}
