/**
 * Сборка `InstancedMesh` из размещающей функции.
 *
 * Черновик один на весь модуль: копий бывают тысячи, и заводить на каждую свой `Object3D`
 * значит платить сборщиком мусора за то, что живёт одну строку.
 */

import * as THREE from 'three';

const draft = new THREE.Object3D();
const draftColor = new THREE.Color();

export function buildInstanced(geometry, material, count, place, tint) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  for (let index = 0; index < count; index += 1) {
    draft.position.set(0, 0, 0);
    draft.rotation.set(0, 0, 0);
    draft.scale.set(1, 1, 1);
    place(draft, index);
    draft.updateMatrix();
    mesh.setMatrixAt(index, draft.matrix);
    if (tint) mesh.setColorAt(index, tint(draftColor, index));
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
