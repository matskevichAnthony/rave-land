import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Выгрузка сцены в .glb, который открывается на телефоне и в Blender штатным импортом.
 *
 * Наружу уходит не сама сцена, а её копия, потому что кадр и файл живут по разным правилам.
 * Инстансы запекаются в обычную геометрию: положенное им расширение glTF чужие импортёры
 * читают через раз. Трафарет афиши переезжает из альфа-маски в цветовую текстуру: отдельной
 * альфа-карты в glTF нет, и без переноса от лайнапа остаются пустые железки без единой буквы.
 * В файл берутся только меши: искры это точки на своём шейдере, и вне сцены они ничего не
 * значат.
 */

const GLB_MIME = 'model/gltf-binary';
const PIXEL_STRIDE = 4;
const RED_CHANNEL = 0;
// Альфа-маску three читает по зелёному каналу, туда же смотрим и мы.
const GREEN_CHANNEL = 1;
const BLUE_CHANNEL = 2;
const ALPHA_CHANNEL = 3;
const FULL_CHANNEL = 255;
const STENCIL_CUTOFF = 0.5;

export async function exportSceneGlb(sources) {
  const baked = bakeCopy(sources);
  try {
    if (baked.root.children.length === 0) throw new Error('в выгрузку не попал ни один меш');
    const binary = await new GLTFExporter().parseAsync(baked.root, { binary: true });
    return new Blob([binary], { type: GLB_MIME });
  } finally {
    baked.dispose();
  }
}

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
