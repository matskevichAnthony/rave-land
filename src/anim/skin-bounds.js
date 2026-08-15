import * as THREE from 'three';

/**
 * Границы скинованного меша по фактической позе.
 *
 * three считает сферу скина один раз, перебором всех вершин, и больше никогда: дальше
 * персонаж анимируется, а сфера остаётся от позы, в которой его застал первый кадр. Стоит
 * позе выйти за её край, и камера отсекает того, кто на самом деле в кадре. Вблизи это видно
 * как мигание: ошибка в метр там занимает четверть экрана, а вдали не значит почти ничего.
 *
 * Перебирать вершины каждый кадр слишком дорого, поэтому сфера собирается по костям: их два-
 * три десятка, а мясо, одежда и волосы вокруг них закрываются запасом.
 */

// Запас на модель считается один раз: клоны делят геометрию, а вершины у них перебираются
// медленно.
const marginCache = new WeakMap();

const workBox = new THREE.Box3();
const toMeshSpace = new THREE.Matrix4();
const point = new THREE.Vector3();

/**
 * Коробка по костям в системе меша: туда же отсечение переводит сферу обратной матрицей.
 *
 * Система считается своей инверсией, а не готовым bindMatrixInverse: тот обновляется только
 * внутри updateMatrixWorld, и стоит позвать соседний updateWorldMatrix, как кости оказываются
 * из этого кадра, а перевод из прошлого. На кадре после телепорта на респавн это уводит сферу
 * на десятки метров.
 */
function boneBox(mesh, target) {
  toMeshSpace.copy(mesh.matrixWorld).invert();
  target.makeEmpty();
  for (const bone of mesh.skeleton.bones) {
    target.expandByPoint(point.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(toMeshSpace));
  }
  return target;
}

/**
 * Насколько тело выходит за свои кости у этой модели.
 *
 * Одним числом на всех тут не обойтись: у гташного скелета кость есть даже в пальце, а у
 * нашего авторига их семнадцать на всё тело, и над макушкой у него ещё капюшон. Поэтому
 * запас мерится по настоящим вершинам в позе покоя, где кости и тело заведомо совпадают.
 */
function measureMargin(mesh) {
  const bones = boneBox(mesh, new THREE.Box3());
  if (bones.isEmpty()) return 0;
  mesh.computeBoundingBox();
  const skin = mesh.boundingBox;
  let margin = 0;
  for (const axis of ['x', 'y', 'z']) {
    margin = Math.max(margin, bones.min[axis] - skin.min[axis], skin.max[axis] - bones.max[axis]);
  }
  return margin;
}

export function createSkinBounds(root) {
  // Замер идёт до первого кадра, когда мировых матриц ещё не считал никто, а скиннинг в
  // computeBoundingBox уже спрашивает их у костей.
  root.updateMatrixWorld(true);
  const skins = [];
  root.traverse((child) => {
    if (!child.isSkinnedMesh) return;
    if (!marginCache.has(child.geometry)) marginCache.set(child.geometry, measureMargin(child));
    skins.push({ mesh: child, margin: marginCache.get(child.geometry) });
  });

  /**
   * Пересчитать сферы по текущей позе.
   *
   * Матрицы обновляются здесь же: аниматор трогает только цепочку доворота, а рендер считает
   * мировые матрицы позже, и сфера собралась бы из костей двух разных кадров.
   */
  return () => {
    root.updateWorldMatrix(true, true);
    for (const { mesh, margin } of skins) {
      if (boneBox(mesh, workBox).isEmpty()) continue;
      workBox.expandByScalar(margin);
      mesh.boundingSphere ??= new THREE.Sphere();
      workBox.getBoundingSphere(mesh.boundingSphere);
    }
  };
}
