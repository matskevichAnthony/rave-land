/**
 * Песок: сама пустыня, рябь, следы и наносы у оснований.
 *
 * Рельеф считается по сумме синусов с фазами от сида, а не по шуму: дюн в кадре немного,
 * и трёх волн хватает, чтобы горизонт перестал быть линейкой. Внутри рабочей площадки
 * рельеф погашен в ноль намеренно: там ходит игрок и стоят коллайдеры, а плоский пол в
 * обвязке дешевле, чем поле высот, которое пришлось бы держать в двух местах сразу.
 *
 * Всё мелкое собрано инстансами: рябь, следы и наносы стоят по одному вызову отрисовки
 * на весь песок, сколько бы их ни было.
 */

import * as THREE from 'three';
import { HALL } from './hall.js';
import { SAND_TILE, scaleUv } from './stone.js';
import { buildInstanced } from '../procedural/instancing.js';
import { between } from '../procedural/random.js';

const TAU = Math.PI * 2;

/** Шаг сетки песка около семи метров: дюны пологие, и дробить их мельче нечем. */
const GROUND = { size: 640, segments: 92, centerZ: -110 };
/** Дюны начинаются за краем площадки и набирают высоту к горизонту. */
const DUNES = {
  calm: [30, 58],
  ramp: 44,
  waves: [
    { amplitude: 3.4, spanX: 71, spanZ: 53 },
    { amplitude: 1.6, spanX: 27, spanZ: 31 },
    { amplitude: 0.7, spanX: 13, spanZ: 9 },
  ],
  tint: 0.07,
};

/** Ветер один на весь кадр: рябь, следы и наносы ложатся по нему, а не вразнобой. */
const WIND = 0.42;

const RIPPLE = {
  count: 260,
  span: [-70, 46],
  reach: 52,
  length: [3.4, 8],
  width: [0.45, 1],
  height: [0.025, 0.06],
  scatter: 0.18,
};

const TRACKS = {
  count: 46,
  from: [15.5, 33],
  to: [1.5, -41],
  wander: 3.4,
  stride: 1.15,
  size: [0.34, 0.07, 0.52],
  sink: 0.4,
};

/**
 * Наносы низкие намеренно.
 *
 * Высокая куча у подножия читается не заносом, а яйцом: у песка, наметённого ветром,
 * пологий профиль, и всё, что выше четверти собственного радиуса, выглядит телом.
 */
const DRIFT = {
  perAnchor: 5,
  radius: [0.8, 1.7],
  spread: [1, 2.3],
  height: [0.1, 0.26],
  squash: [0.4, 0.8],
};

/**
 * Высота песка в точке.
 *
 * Затухание считается по расстоянию наружу от прямоугольника площадки: внутри ноль,
 * дальше плавный набор. Так дюна не может вылезти под ноги и оторвать игрока от пола.
 */
export function createDunes(rng) {
  const phases = DUNES.waves.map(() => [rng() * TAU, rng() * TAU]);

  function heightAt(x, z) {
    const outX = Math.max(Math.abs(x) - DUNES.calm[0], 0);
    const outZ = Math.max(Math.abs(z - (HALL.frontZ + HALL.endZ) / 2) - DUNES.calm[1], 0);
    const away = Math.hypot(outX, outZ);
    if (away <= 0) return 0;
    const mask = Math.min(1, away / DUNES.ramp);
    let height = 0;
    for (let index = 0; index < DUNES.waves.length; index += 1) {
      const wave = DUNES.waves[index];
      const [phaseX, phaseZ] = phases[index];
      height += wave.amplitude
        * Math.sin(x / wave.spanX + phaseX)
        * Math.cos(z / wave.spanZ + phaseZ);
    }
    return height * mask * mask;
  }

  return { heightAt };
}

/**
 * Полотно пустыни с продавленными дюнами и лёгкой раскраской по высоте.
 *
 * Раскраска идёт вершинным цветом, а не второй текстурой: гребню достаётся выбеленный
 * песок, ложбине тёмный, и плоскость перестаёт быть одним пятном на весь нижний кадр.
 */
export function createSand({ rng, material, dunes }) {
  const geometry = new THREE.PlaneGeometry(
    GROUND.size,
    GROUND.size,
    GROUND.segments,
    GROUND.segments,
  ).rotateX(-Math.PI / 2).translate(0, 0, GROUND.centerZ);
  scaleUv(geometry, GROUND.size, GROUND.size, SAND_TILE);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const tint = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const z = position.getZ(index);
    const height = dunes.heightAt(x, z);
    position.setY(index, height);
    const lift = 1 + DUNES.tint * (height * 0.4 + between(rng, -0.5, 0.5));
    tint.setRGB(lift, lift, lift);
    colors[index * 3] = tint.r;
    colors[index * 3 + 1] = tint.g;
    colors[index * 3 + 2] = tint.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const sand = material.clone();
  sand.vertexColors = true;

  const mesh = new THREE.Mesh(geometry, sand);
  mesh.receiveShadow = true;
  return mesh;
}

/** Ветровая рябь: длинные пологие валики поперёк ветра, гуще ближе к камере. */
export function createRipples({ rng, material, dunes }) {
  const ridges = Array.from({ length: RIPPLE.count }, () => {
    const x = between(rng, -RIPPLE.reach, RIPPLE.reach);
    const z = between(rng, ...RIPPLE.span);
    return {
      x,
      z,
      y: dunes.heightAt(x, z),
      turn: WIND + between(rng, -RIPPLE.scatter, RIPPLE.scatter),
      length: between(rng, ...RIPPLE.length),
      width: between(rng, ...RIPPLE.width),
      height: between(rng, ...RIPPLE.height),
    };
  });

  return buildInstanced(
    new THREE.SphereGeometry(0.5, 8, 4),
    material,
    ridges.length,
    (draft, index) => {
      const ridge = ridges[index];
      draft.position.set(ridge.x, ridge.y, ridge.z);
      draft.rotation.y = ridge.turn;
      draft.scale.set(ridge.width, ridge.height, ridge.length);
    },
  );
}

/**
 * Следы: кто-то прошёл к воротам и не вернулся.
 *
 * Шаг ставится попеременно вправо и влево от линии хода, поэтому цепочка читается ходьбой,
 * а не пунктиром. Отпечаток вдавлен в песок наполовину: целая полусфера торчала бы бугром.
 */
export function createTracks({ rng, material, dunes }) {
  const prints = Array.from({ length: TRACKS.count }, (unused, index) => {
    const walk = index / (TRACKS.count - 1);
    const wander = Math.sin(walk * Math.PI * 1.7) * TRACKS.wander;
    const side = index % 2 ? TRACKS.stride : -TRACKS.stride;
    const x = TRACKS.from[0] + (TRACKS.to[0] - TRACKS.from[0]) * walk + wander + side * 0.5;
    const z = TRACKS.from[1] + (TRACKS.to[1] - TRACKS.from[1]) * walk;
    return { x, z, y: dunes.heightAt(x, z), turn: between(rng, -0.3, 0.3) };
  });

  return buildInstanced(
    new THREE.SphereGeometry(0.5, 8, 6),
    material,
    prints.length,
    (draft, index) => {
      const print = prints[index];
      draft.position.set(print.x, print.y - TRACKS.size[1] * TRACKS.sink, print.z);
      draft.rotation.y = WIND + print.turn;
      draft.scale.set(...TRACKS.size);
    },
  );
}

/**
 * Наносы у оснований: песок, наметённый к тому, что стоит в пустыне давно.
 *
 * Опорные точки приходят от расстановки монументов. Своего списка координат здесь нет:
 * подвинули колосса, наносы уехали с ним.
 */
export function createDrifts({ rng, material, dunes, anchors }) {
  const heaps = anchors.flatMap((anchor) => Array.from(
    { length: DRIFT.perAnchor },
    () => {
      const turn = rng() * TAU;
      const away = anchor.radius * between(rng, ...DRIFT.spread);
      const x = anchor.x + Math.cos(turn) * away;
      const z = anchor.z + Math.sin(turn) * away;
      return {
        x,
        z,
        y: dunes.heightAt(x, z),
        radius: anchor.radius * between(rng, ...DRIFT.radius),
        height: between(rng, ...DRIFT.height) * anchor.radius,
        squash: between(rng, ...DRIFT.squash),
        turn,
      };
    },
  ));

  const mesh = buildInstanced(
    new THREE.SphereGeometry(1, 12, 8),
    material,
    heaps.length,
    (draft, index) => {
      const heap = heaps[index];
      draft.position.set(heap.x, heap.y - heap.height * 0.35, heap.z);
      draft.rotation.y = heap.turn;
      draft.scale.set(heap.radius, heap.height, heap.radius * heap.squash);
    },
  );
  mesh.receiveShadow = true;
  return mesh;
}
