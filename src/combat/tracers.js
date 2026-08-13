import * as THREE from 'three';

/**
 * Трассеры и подсветка выстрела одним общим пулом на всю сцену.
 *
 * Каждый выстрел раньше добавлял в сцену новый источник света, а от этого three пересобирает
 * программы всех материалов сцены: нажатие на курок стоило компиляции шейдеров (F-056).
 * Поэтому и линии, и лампы заводятся один раз и только переставляются, а гаснут яркостью.
 * Стреляет теперь вся арена сразу, поэтому пул, а не одна линия.
 */

const TRACER_SECONDS = 0.07;
const TRACER_COLOR = '#ffe9a8';
const TRACER_COUNT = 12;
const LIGHT_COLOR = '#ffca7a';
const LIGHT_INTENSITY = 40;
const LIGHT_RANGE = 8;
const LIGHT_SECONDS = 0.05;
const LIGHT_COUNT = 4;

function buildTracer() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({ color: TRACER_COLOR, transparent: true, opacity: 0.9 }),
  );
  // Отсечение по объёму снято: границы геометрии переезжают вместе с выстрелом, а считать их
  // заново ради двух вершин дороже, чем нарисовать.
  line.frustumCulled = false;
  line.visible = false;
  return line;
}

export function createTracers(scene) {
  const lines = Array.from({ length: TRACER_COUNT }, () => ({ line: buildTracer(), left: 0 }));
  const lights = Array.from({ length: LIGHT_COUNT }, () => ({
    light: new THREE.PointLight(LIGHT_COLOR, 0, LIGHT_RANGE), left: 0 }));
  scene.add(...lines.map((entry) => entry.line), ...lights.map((entry) => entry.light));
  let nextLine = 0;
  let nextLight = 0;

  function spawn(from, to) {
    const entry = lines[nextLine];
    nextLine = (nextLine + 1) % lines.length;
    const points = entry.line.geometry.getAttribute('position');
    points.setXYZ(0, from.x, from.y, from.z);
    points.setXYZ(1, to.x, to.y, to.z);
    points.needsUpdate = true;
    entry.line.visible = true;
    entry.left = TRACER_SECONDS;

    const lamp = lights[nextLight];
    nextLight = (nextLight + 1) % lights.length;
    lamp.light.position.copy(from);
    lamp.light.intensity = LIGHT_INTENSITY;
    lamp.left = LIGHT_SECONDS;
  }

  function update(dt) {
    for (const entry of lines) {
      if (entry.left <= 0) continue;
      entry.left -= dt;
      if (entry.left <= 0) entry.line.visible = false;
    }
    for (const entry of lights) {
      if (entry.left <= 0) continue;
      entry.left -= dt;
      if (entry.left <= 0) entry.light.intensity = 0;
    }
  }

  return { spawn, update };
}
