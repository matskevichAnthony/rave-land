import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { writeObj } from './export-obj.js';
import { writeFbx } from './export-fbx.js';

/**
 * Выгрузка сцены в файл: GLB, OBJ с MTL или двоичный FBX.
 *
 * Запекание у всех трёх одно, и оно здесь, а форматы живут по своим модулям: разница между
 * ними в том, как записать готовые треугольники, а не в том, что считать сценой.
 *
 * Наружу уходит не сама сцена, а её копия, потому что кадр и файл живут по разным правилам.
 * Инстансы запекаются в обычную геометрию: положенное им расширение glTF чужие импортёры
 * читают через раз. Трафарет афиши переезжает из альфа-маски в цветовую текстуру: отдельной
 * альфа-карты в glTF нет, и без переноса от лайнапа остаются пустые железки без единой буквы.
 * В файл берутся только меши: искры это точки на своём шейдере, и вне сцены они ничего не
 * значат. Текстуру трафарета несёт только GLB: ни OBJ, ни FBX не тянут за собой картинку,
 * и в них от лайнапа остаются плиты, а буквы приходят вместе с glTF.
 */

const GLB_MIME = 'model/gltf-binary';
const IDENTITY = new THREE.Matrix4();

const PIXEL_STRIDE = 4;
const RED_CHANNEL = 0;
// Альфа-маску three читает по зелёному каналу, туда же смотрим и мы.
const GREEN_CHANNEL = 1;
const BLUE_CHANNEL = 2;
const ALPHA_CHANNEL = 3;
const FULL_CHANNEL = 255;
const STENCIL_CUTOFF = 0.5;

/**
 * Сцена файлами: одним для GLB и FBX, двумя для OBJ, которому нужен MTL рядом.
 *
 * `stem` это имя без расширения: OBJ пишет имя своего MTL внутрь себя, поэтому имена файлов
 * знает выгрузка, а не тот, кто их потом сохраняет.
 */
export async function exportScene({ sources, format, stem }) {
  const write = WRITERS[format];
  if (!write) throw new Error(`формата «${format}» нет: есть ${Object.keys(WRITERS).join(', ')}`);
  const baked = bakeCopy(sources);
  try {
    if (baked.root.children.length === 0) throw new Error('в выгрузку не попал ни один меш');
    return await write(baked.root, stem);
  } finally {
    baked.dispose();
  }
}

async function writeGlb(root, stem) {
  const binary = await new GLTFExporter().parseAsync(root, { binary: true });
  return [{ name: `${stem}.glb`, blob: new Blob([binary], { type: GLB_MIME }) }];
}

/**
 * Части сцены в мировых координатах.
 *
 * GLTFExporter забирает граф как есть и матрицы складывает сам, а свои писатели пишут голые
 * числа: своей матрицы у меша в OBJ нет вовсе, а в FBX она была бы вторым слоем поверх уже
 * посчитанных координат. Поэтому им геометрия отдаётся уже перенесённой.
 *
 * Копии инстансов приходят из запекания уже сведёнными в мировых координатах, у них матрица
 * единичная и копировать геометрию второй раз незачем.
 */
function worldParts(root) {
  const spent = [];
  const parts = root.children.map((mesh, order) => {
    const moved = !mesh.matrix.equals(IDENTITY);
    const geometry = moved ? mesh.geometry.clone().applyMatrix4(mesh.matrix) : mesh.geometry;
    if (moved) spent.push(geometry);
    return { name: `part-${order}`, geometry, material: mesh.material };
  });
  return { parts, dispose: () => spent.forEach((geometry) => geometry.dispose()) };
}

/** Свой писатель формата: запечённая сцена приводится к мировым частям и обратно. */
function textWriter(write) {
  return (root, stem) => {
    const world = worldParts(root);
    try {
      return write(world.parts, stem);
    } finally {
      world.dispose();
    }
  };
}

const WRITERS = {
  glb: writeGlb,
  obj: textWriter(writeObj),
  fbx: textWriter(writeFbx),
};

/**
 * Копия сцены под выгрузку: плоский список мешей в мировых координатах.
 *
 * Иерархия не переносится намеренно. Часть матриц сцены живёт не в узлах, а в инстансах,
 * и любой перенесённый родитель применил бы свой поворот вторым слоем.
 */
function bakeCopy(sources) {
  const root = new THREE.Group();
  const spent = [];
  const stencilled = new Map();

  for (const source of sources) {
    source.updateMatrixWorld(true);
    gather(source);
  }

  return {
    root,
    dispose() {
      for (const item of spent) item.dispose();
    },
  };

  function gather(node) {
    if (!node.visible) return;
    const mesh = bakeMesh(node);
    if (mesh) root.add(mesh);
    for (const child of node.children) gather(child);
  }

  function bakeMesh(node) {
    if (!node.isMesh || !paintsSurface(node.material)) return null;
    const material = materialFor(node.material);
    if (node.isInstancedMesh) {
      return new THREE.Mesh(mergeInstances(node, material.vertexColors), material);
    }
    const mesh = new THREE.Mesh(node.geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(node.matrixWorld);
    return mesh;
  }

  function mergeInstances(node, tinted) {
    const placement = new THREE.Matrix4();
    const tint = new THREE.Color();
    const copies = [];
    for (let index = 0; index < node.count; index += 1) {
      node.getMatrixAt(index, placement);
      const copy = node.geometry.clone().applyMatrix4(placement.premultiply(node.matrixWorld));
      if (tinted && node.instanceColor) {
        node.getColorAt(index, tint);
        paintVertices(copy, tint);
      }
      copies.push(copy);
    }
    const merged = mergeGeometries(copies);
    for (const copy of copies) copy.dispose();
    if (!merged) throw new Error('копии инстанса не слились в одну геометрию');
    spent.push(merged);
    return merged;
  }

  function materialFor(material) {
    if (!material.alphaMap) return material;
    const known = stencilled.get(material);
    if (known) return known;
    if (material.map) throw new Error('карта и трафарет разом: в glTF такой материал не переезжает');
    const baked = material.clone();
    baked.alphaMap = null;
    baked.map = stencilToMap(material.alphaMap);
    // glTF знает вместо альфа-карты только режим маски: буква либо есть, либо её нет.
    baked.transparent = false;
    baked.alphaTest = material.alphaTest || STENCIL_CUTOFF;
    spent.push(baked);
    stencilled.set(material, baked);
    return baked;
  }

  /** Трафарет в цветовую текстуру: цвет плиты остаётся в материале, картинка несёт вырез. */
  function stencilToMap(alphaMap) {
    const mask = alphaMap.image;
    const canvas = document.createElement('canvas');
    canvas.width = mask.width;
    canvas.height = mask.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('холст трафарета не отдал контекст');
    context.drawImage(mask, 0, 0);
    const painted = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let at = 0; at < painted.data.length; at += PIXEL_STRIDE) {
      const stencil = painted.data[at + GREEN_CHANNEL];
      painted.data[at + RED_CHANNEL] = FULL_CHANNEL;
      painted.data[at + GREEN_CHANNEL] = FULL_CHANNEL;
      painted.data[at + BLUE_CHANNEL] = FULL_CHANNEL;
      painted.data[at + ALPHA_CHANNEL] = stencil;
    }
    context.putImageData(painted, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = alphaMap.flipY;
    texture.colorSpace = THREE.SRGBColorSpace;
    spent.push(texture);
    return texture;
  }
}

/**
 * В файл уходит поверхность, а не смешивание.
 *
 * Дымка, лучи, ореолы огня и копоть держатся аддитивным сложением с выключенной записью
 * глубины: в чужом вьюере это стопка мутных плоскостей поперёк зала, а не зал.
 */
function paintsSurface(material) {
  return Boolean(material) && material.depthWrite;
}

/** Цвет копии переезжает в цвет вершин: в обычном меше другого места для него нет. */
function paintVertices(geometry, tint) {
  const count = geometry.getAttribute('position').count;
  const colors = geometry.getAttribute('color')
    ?? new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3);
  for (let index = 0; index < count; index += 1) {
    colors.setXYZ(
      index,
      colors.getX(index) * tint.r,
      colors.getY(index) * tint.g,
      colors.getZ(index) * tint.b,
    );
  }
  geometry.setAttribute('color', colors);
}
