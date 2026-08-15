/**
 * Небо полудня и марево над горизонтом.
 *
 * Купол это одна сфера изнутри с нарисованным градиентом: от выбеленной пыли у земли до
 * плотной синевы в зените. Цвет горизонта совпадает с цветом тумана сцены, поэтому песок
 * не кончается краем, а растворяется.
 *
 * Марево сделано отдельным поясом: полупрозрачная лента вокруг всей сцены, которая ползёт
 * поперёк кадра и подъедает основания дальних пирамид. Без неё расстояние читается только
 * размером, а с ней воздух в кадре становится плотным телом.
 */

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createBlobTexture, rgba } from '../procedural/canvas-texture.js';
import { openBandY } from '../procedural/shapes.js';

const DOME = { radius: 620, segments: [32, 20], texture: 256 };
/**
 * Разметка градиента по развёртке сферы.
 *
 * В кадре видно от силы двадцать пять градусов неба, а это всего седьмая часть развёртки
 * над горизонтом. Растянутый переход давал белую стену вместо неба: синева начиналась
 * выше верхнего края кадра. Поэтому пыль кончается сразу над горизонтом, а зенит взят
 * на трёх четвертях.
 */
const HORIZON = { level: 0.5, warm: 0.507, cool: 0.535, deep: 0.6 };
/**
 * Пояс марева низкий и слабый намеренно.
 *
 * Тридцать четыре метра высоты и треть непрозрачности накрывали не основания дальних
 * пирамид, а их целиком, и вместе с туманом давали ту самую пелену: силуэт переставал
 * читаться, кадр белел. Двадцать метров хватает, чтобы подъесть низ дальнего плана и
 * оставить верх пирамиды в чистом воздухе.
 */
const SHIMMER = {
  radius: 430,
  height: 20,
  lift: 6,
  segments: 60,
  opacity: 0.15,
  scroll: 0.004,
  blobs: 34,
};

/** Градиент неба: снизу выбеленная пыль, выше синева. Развёртка сферы идёт снизу вверх. */
function createDomeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = DOME.texture;
  const ctx = canvas.getContext('2d');
  const band = ctx.createLinearGradient(0, DOME.texture, 0, 0);
  band.addColorStop(0, PALETTE.sandDeep);
  band.addColorStop(HORIZON.level, PALETTE.haze);
  band.addColorStop(HORIZON.warm, PALETTE.haze);
  band.addColorStop(HORIZON.cool, PALETTE.sky);
  band.addColorStop(HORIZON.deep, PALETTE.zenith);
  band.addColorStop(1, PALETTE.zenith);
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, 1, DOME.texture);
  return new THREE.CanvasTexture(canvas);
}

/** Лента марева: белёсый пояс, гаснущий вверх и вниз. */
function createShimmerTexture(rng) {
  const texture = createBlobTexture({
    random: rng,
    size: 256,
    blobs: SHIMMER.blobs,
    radius: [0.15, 0.5],
    alpha: [0.1, 0.4],
    color: PALETTE.haze,
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(6, 1);
  return texture;
}

function createFade() {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const fade = ctx.createLinearGradient(0, 64, 0, 0);
  fade.addColorStop(0, rgba(PALETTE.haze, 0));
  fade.addColorStop(0.34, rgba(PALETTE.haze, 1));
  fade.addColorStop(1, rgba(PALETTE.haze, 0));
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 1, 64);
  return new THREE.CanvasTexture(canvas);
}

export function createSky(rng) {
  const group = new THREE.Group();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DOME.radius, ...DOME.segments),
    new THREE.MeshBasicMaterial({
      map: createDomeTexture(),
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    }),
  );
  dome.renderOrder = -1;
  group.add(dome);

  const haze = createShimmerTexture(rng);
  const shimmer = new THREE.Mesh(
    openBandY({ segments: SHIMMER.segments })
      .scale(SHIMMER.radius, SHIMMER.height, SHIMMER.radius),
    new THREE.MeshBasicMaterial({
      map: haze,
      alphaMap: createFade(),
      color: PALETTE.haze,
      side: THREE.BackSide,
      transparent: true,
      opacity: SHIMMER.opacity,
      depthWrite: false,
      fog: false,
    }),
  );
  shimmer.position.y = SHIMMER.lift;
  group.add(shimmer);

  function update(elapsed) {
    haze.offset.x = elapsed * SHIMMER.scroll;
  }

  return { group, update };
}
