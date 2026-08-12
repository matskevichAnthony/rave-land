import { closeSync, openSync, readSync } from 'node:fs';

/** Полигонаж и габариты GLB, прочитанные из самого файла.
 *
 * Геометрию читать незачем: glTF обязывает аксессор позиций нести min и max, а
 * число треугольников известно из count индексов. Габариты меряются в осях
 * файла (Y вверх), то есть в тех же, в которых их потом намерит three.js.
 *
 * Две поправки, без которых цифры врут. Сжатые модели держат координаты целыми,
 * их делят на предел типа. У скина позиции живут в пространстве привязки, и
 * вернуть их в метры может только матрица первой кости, помноженная на её же
 * обратную матрицу привязки: постпроцесс прячет масштаб именно туда, а не в узел.
 */

const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const TRIANGLES_MODE = 4;
const MATRIX_BYTES = 64;
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const NORMALIZED_UNIT = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

export function measureGlb(path) {
  const file = openSync(path, 'r');
  try {
    const { gltf, binaryAt } = readChunks(file, path);
    const world = worldMatrices(gltf);
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    let triangles = 0;

    for (const [index, node] of gltf.nodes?.entries() ?? []) {
      if (node.mesh === undefined || !world.has(index)) continue;
      const matrix = node.skin === undefined
        ? world.get(index)
        : bindMatrix(gltf, file, binaryAt, gltf.skins[node.skin], world);
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        triangles += triangleCount(gltf, primitive);
        expand(box, gltf.accessors[primitive.attributes.POSITION], matrix);
      }
    }

    const size = box.max.map((high, axis) => round(high - box.min[axis]));
    return { triangles, size: size.every(Number.isFinite) ? size : null };
  } finally {
    closeSync(file);
  }
}

function readChunks(file, path) {
  const head = Buffer.alloc(HEADER_BYTES + CHUNK_HEADER_BYTES);
  readSync(file, head, 0, head.length, 0);
  if (head.readUInt32LE(0) !== MAGIC) throw new Error(`${path}: это не GLB`);
  if (head.readUInt32LE(HEADER_BYTES + 4) !== JSON_CHUNK) {
    throw new Error(`${path}: первый чанк не JSON`);
  }
  const length = head.readUInt32LE(HEADER_BYTES);
  const json = Buffer.alloc(length);
  readSync(file, json, 0, length, head.length);
  return {
    gltf: JSON.parse(json.toString('utf8')),
    binaryAt: head.length + length + CHUNK_HEADER_BYTES,
  };
}

/** Матрицы узлов в мире файла: считаются обходом сцены, чужие ветки не нужны. */
function worldMatrices(gltf) {
  const world = new Map();
  const walk = (index, parent) => {
    const node = gltf.nodes[index];
    const matrix = multiply(parent, localMatrix(node));
    world.set(index, matrix);
    for (const child of node.children ?? []) walk(child, matrix);
  };
  const scene = gltf.scenes?.[gltf.scene ?? 0];
  for (const index of scene?.nodes ?? []) walk(index, IDENTITY);
  return world;
}

function bindMatrix(gltf, file, binaryAt, skin, world) {
  const joint = world.get(skin.joints[0]) ?? IDENTITY;
  if (skin.inverseBindMatrices === undefined) return joint;
  return multiply(joint, readMatrix(gltf, file, binaryAt, skin.inverseBindMatrices));
}

function readMatrix(gltf, file, binaryAt, accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const view = gltf.bufferViews[accessor.bufferView];
  const bytes = Buffer.alloc(MATRIX_BYTES);
  readSync(file, bytes, 0, MATRIX_BYTES, binaryAt + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0));
  return [...new Float32Array(bytes.buffer, bytes.byteOffset, 16)];
}

function triangleCount(gltf, primitive) {
  if ((primitive.mode ?? TRIANGLES_MODE) !== TRIANGLES_MODE) return 0;
  const accessor = primitive.indices ?? primitive.attributes.POSITION;
  return Math.floor(gltf.accessors[accessor].count / 3);
}

/** Габарит собирается по углам аксессора: узел мог быть повёрнут и отмасштабирован. */
function expand(box, accessor, matrix) {
  if (!accessor?.min || !accessor?.max) return;
  const unit = accessor.normalized ? NORMALIZED_UNIT[accessor.componentType] : 1;
  for (let corner = 0; corner < 8; corner += 1) {
    const point = transform(matrix, [
      (corner & 1 ? accessor.max[0] : accessor.min[0]) / unit,
      (corner & 2 ? accessor.max[1] : accessor.min[1]) / unit,
      (corner & 4 ? accessor.max[2] : accessor.min[2]) / unit,
    ]);
    for (let axis = 0; axis < 3; axis += 1) {
      box.min[axis] = Math.min(box.min[axis], point[axis]);
      box.max[axis] = Math.max(box.max[axis], point[axis]);
    }
  }
}

function localMatrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
    (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
    (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function multiply(left, right) {
  const result = new Array(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      for (let step = 0; step < 4; step += 1) {
        result[column * 4 + row] += left[step * 4 + row] * right[column * 4 + step];
      }
    }
  }
  return result;
}

function transform(matrix, [x, y, z]) {
  return [0, 1, 2].map((row) => (
    matrix[row] * x + matrix[4 + row] * y + matrix[8 + row] * z + matrix[12 + row]
  ));
}

function round(value) {
  return Math.round(value * 100) / 100;
}
