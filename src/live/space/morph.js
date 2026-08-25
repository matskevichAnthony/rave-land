/**
 * Формы тел и перетекание между ними: все фигуры собраны на одной сетке.
 *
 * Главное решение файла в том, что развёртка у всех форм общая. Каждая форма описана функцией
 * (u, v) в точку на одной и той же сетке, поэтому у шара, узла и полотна совпадает и число
 * вершин, и их порядок, и все треугольники. Пока это так, переход одной формы в другую не
 * требует ни морф-таргетов, ни пересборки геометрии посреди сета: вершинный шейдер смешивает
 * два набора атрибутов, и тело в самом деле меняет форму, а не притворяется мятой поверхностью.
 *
 * Буферы общие на все тела. Оболочка формы считается один раз и раздаётся всем, кто её
 * попросил: два десятка тел держат два десятка BufferGeometry, но за ними стоит по одной паре
 * буферов на форму. Геометрии не выбрасываются, а возвращаются в запас, потому что сброс
 * геометрии уносит с собой общие буферы соседей, и видеокарте пришлось бы заливать их заново
 * на каждую смерть тела.
 *
 * Нормали берутся разностью по сетке, а не выводятся формулой. Разность одна на все формы, а
 * производные пришлось бы выводить для каждой заново, и любая новая форма стоила бы вывода
 * формулы вместо трёх строк её собственного описания.
 */

import * as THREE from 'three';

export const MIX_SHAPE = 'mix';

export const SHAPES = [
  { id: MIX_SHAPE, label: 'Вразнобой' },
  { id: 'blob', label: 'Ком' },
  { id: 'knot', label: 'Узел' },
  { id: 'ring', label: 'Кольцо' },
  { id: 'slab', label: 'Плита' },
  { id: 'sheet', label: 'Полотно' },
  { id: 'tube', label: 'Труба' },
  { id: 'spiral', label: 'Спираль' },
  { id: 'bloom', label: 'Соцветие' },
];

export const DEFAULT_SHAPE = MIX_SHAPE;

// Сетка: 96 шагов по длинной развёртке и 32 поперёк. Длинная сторона идёт вдоль кривой у узла,
// спирали и трубы, а на трёх десятках шагов узел читается гранёной колбасой, и никакой морф
// этого не спасает. Выходит 3201 вершина и 6144 треугольника на тело, то есть 64 тысячи вершин
// за кадр при двадцати телах. Это заметно дешевле пары полноэкранных проходов рядом.
const GRID_U = 96;
const GRID_V = 32;
const COLUMNS = GRID_U + 1;
const ROWS = GRID_V + 1;
const VERTICES = COLUMNS * ROWS;
const QUADS = GRID_U * GRID_V;

// Сфера охвата ставится руками и навсегда. Атрибут position подменяется на каждом переходе, и
// честный пересчёт означал бы обход всех вершин тела посреди сета. Радиуса хватает на самую
// размашистую форму вместе с мятием поверх неё.
const BOUND = 2.2;

// Разность для нормали в долях развёртки. Крупнее, и нормаль сгладит складки самой формы,
// мельче, и в неё полезет ошибка float, от которой поверхность идёт рябью.
const NUDGE = 0.002;
const DEGENERATE = 1e-10;

const TAU = Math.PI * 2;

const BLOB_LUMP = 0.09;

const BLOOM_CORE = 0.82;
const BLOOM_PETAL = 0.32;

const RING_RADIUS = 0.95;
const RING_TUBE = 0.3;

const TUBE_RADIUS = 0.62;
const TUBE_HEIGHT = 2.2;

// Показатель степени, которым шар превращается в кирпич: чем он меньше, тем острее рёбра. Ноль
// дал бы честный куб с изломом нормали на ребре, и перетекание из него читалось бы поломкой.
const SLAB_EDGE = 0.35;
const SLAB_SIZE = { x: 1.05, y: 1.05, z: 0.6 };

const SHEET_WIDTH = 2.4;
const SHEET_HEIGHT = 1.4;
const SHEET_CURL = 0.26;
const SHEET_BEND = 1.3;

const KNOT_P = 2;
const KNOT_Q = 3;
const KNOT_RADIUS = 0.62;
const KNOT_TUBE = 0.24;

const SPIRAL_TURNS = 2.5;
const SPIRAL_RADIUS = 0.6;
const SPIRAL_RISE = 1.9;
const SPIRAL_TUBE = 0.17;

// Шаг вперёд по кривой, которым берётся касательная. Мельче, и разность утонет в ошибке float.
const CURVE_LOOK = 0.004;

const anchor = new THREE.Vector3();
const ahead = new THREE.Vector3();
const tangent = new THREE.Vector3();
const side = new THREE.Vector3();
const lift = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

const ball = (around, down, radius, out) => out.set(
  Math.sin(down) * Math.cos(around) * radius,
  Math.cos(down) * radius,
  Math.sin(down) * Math.sin(around) * radius,
);

const boxy = (part) => Math.sign(part) * Math.abs(part) ** SLAB_EDGE;

/**
 * Трубка заданной толщины вокруг кривой.
 *
 * Рама берётся от самой кривой, а не по Френе. У Френе нормаль переворачивается на перегибе, и
 * трубка в этом месте перекручивается на пол-оборота. Обе здешние кривые обходят начало
 * координат, поэтому вектор на него даёт устойчивую поперечину без всяких перегибов.
 */
function sweep(curve, along, around, thickness, out) {
  curve(along, anchor);
  curve(along + CURVE_LOOK, ahead);
  tangent.subVectors(ahead, anchor).normalize();
  side.crossVectors(tangent, anchor);
  if (side.lengthSq() < DEGENERATE) side.crossVectors(tangent, UP);
  side.normalize();
  lift.crossVectors(side, tangent).normalize();
  out.copy(anchor)
    .addScaledVector(side, Math.cos(around) * thickness)
    .addScaledVector(lift, Math.sin(around) * thickness);
}

function knotCurve(along, out) {
  const turn = along * TAU * KNOT_P;
  const cross = (KNOT_Q / KNOT_P) * turn;
  const width = (2 + Math.cos(cross)) * 0.5 * KNOT_RADIUS;
  out.set(width * Math.cos(turn), Math.sin(cross) * 0.5 * KNOT_RADIUS, width * Math.sin(turn));
}

function spiralCurve(along, out) {
  const turn = along * TAU * SPIRAL_TURNS;
  out.set(
    Math.cos(turn) * SPIRAL_RADIUS,
    (along - 0.5) * SPIRAL_RISE,
    Math.sin(turn) * SPIRAL_RADIUS,
  );
}

// Форма обязана считаться и чуть за краем развёртки: нормаль берётся разностью, и на кромке
// сетки ей нужен шаг наружу. Все здешние либо периодические, либо продолжаются сами собой.
const FORMS = {
  blob(u, v, out) {
    const around = u * TAU;
    const down = v * Math.PI;
    ball(around, down, 1 + BLOB_LUMP * Math.sin(around * 3) * Math.sin(down * 2), out);
  },
  bloom(u, v, out) {
    const around = u * TAU;
    const down = v * Math.PI;
    ball(around, down, BLOOM_CORE + BLOOM_PETAL * Math.cos(around * 5) * Math.sin(down * 3), out);
  },
  ring(u, v, out) {
    const around = u * TAU;
    const across = v * TAU;
    const width = RING_RADIUS + RING_TUBE * Math.cos(across);
    out.set(width * Math.cos(around), RING_TUBE * Math.sin(across), width * Math.sin(around));
  },
  tube(u, v, out) {
    const around = u * TAU;
    out.set(
      Math.cos(around) * TUBE_RADIUS,
      (0.5 - v) * TUBE_HEIGHT,
      Math.sin(around) * TUBE_RADIUS,
    );
  },
  slab(u, v, out) {
    ball(u * TAU, v * Math.PI, 1, out);
    out.set(boxy(out.x) * SLAB_SIZE.x, boxy(out.y) * SLAB_SIZE.y, boxy(out.z) * SLAB_SIZE.z);
  },
  sheet(u, v, out) {
    out.set(
      (u - 0.5) * SHEET_WIDTH,
      (v - 0.5) * SHEET_HEIGHT,
      Math.sin(u * Math.PI * SHEET_BEND) * SHEET_CURL,
    );
  },
  knot(u, v, out) {
    sweep(knotCurve, u, v * TAU, KNOT_TUBE, out);
  },
  spiral(u, v, out) {
    sweep(spiralCurve, u, v * TAU, SPIRAL_TUBE, out);
  },
};

const SPAWNABLE = SHAPES.filter(({ id }) => id !== MIX_SHAPE).map(({ id }) => id);

export const someShape = () => SPAWNABLE[Math.floor(Math.random() * SPAWNABLE.length)];

/** Любая форма, кроме этой. Считается сдвигом по кругу, чтобы не крутить цикл до удачи. */
export const otherThan = (id) => {
  const shift = 1 + Math.floor(Math.random() * (SPAWNABLE.length - 1));
  return SPAWNABLE[(SPAWNABLE.indexOf(id) + shift + SPAWNABLE.length) % SPAWNABLE.length];
};

const here = new THREE.Vector3();
const alongU = new THREE.Vector3();
const alongV = new THREE.Vector3();
const facing = new THREE.Vector3();

/** Оболочка формы: позиции и нормали на общей сетке, посчитанные один раз за весь сет. */
function shell(form) {
  const positions = new Float32Array(VERTICES * 3);
  const normals = new Float32Array(VERTICES * 3);

  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const u = column / GRID_U;
      const v = row / GRID_V;
      // У нижней кромки шаг берётся назад: за ней у замкнутых форм развёртка идёт обратно, и
      // разность вперёд дала бы нормаль, вывернутую наизнанку ровно на последнем ряду.
      const backward = v > 1 - NUDGE;
      form(u, v, here);
      form(u + NUDGE, v, alongU);
      form(u, backward ? v - NUDGE : v + NUDGE, alongV);
      alongU.sub(here);
      alongV.sub(here);
      if (backward) alongV.negate();
      facing.crossVectors(alongU, alongV);
      // На полюсе обе разности сходятся в точку и площадь вырождается в ноль. Направление там
      // всё равно известно: полюс смотрит туда же, куда указывает сам радиус.
      if (facing.lengthSq() < DEGENERATE) facing.copy(here);
      facing.normalize();

      const at = (row * COLUMNS + column) * 3;
      positions[at] = here.x;
      positions[at + 1] = here.y;
      positions[at + 2] = here.z;
      normals[at] = facing.x;
      normals[at + 1] = facing.y;
      normals[at + 2] = facing.z;
    }
  }

  return {
    position: new THREE.BufferAttribute(positions, 3),
    normal: new THREE.BufferAttribute(normals, 3),
  };
}

function skinUv() {
  const uv = new Float32Array(VERTICES * 2);
  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const at = (row * COLUMNS + column) * 2;
      uv[at] = column / GRID_U;
      uv[at + 1] = row / GRID_V;
    }
  }
  return new THREE.BufferAttribute(uv, 2);
}

/** Порядок вершин в треугольнике совпадает с нормалью: лицо там, куда она смотрит. */
function weave() {
  const index = new Uint16Array(QUADS * 6);
  let at = 0;
  for (let row = 0; row < GRID_V; row += 1) {
    for (let column = 0; column < GRID_U; column += 1) {
      const corner = row * COLUMNS + column;
      const below = corner + COLUMNS;
      index[at] = corner;
      index[at + 1] = corner + 1;
      index[at + 2] = below + 1;
      index[at + 3] = corner;
      index[at + 4] = below + 1;
      index[at + 5] = below;
      at += 6;
    }
  }
  return new THREE.BufferAttribute(index, 1);
}

export function createShapes() {
  const shells = new Map();
  const made = [];
  const spare = [];
  const uv = skinUv();
  const index = weave();

  const shellOf = (id) => {
    if (!shells.has(id)) shells.set(id, shell(FORMS[id]));
    return shells.get(id);
  };

  function blank() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('uv', uv);
    geometry.setIndex(index);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOUND);
    made.push(geometry);
    return geometry;
  }

  /** Пара форм на одном теле: откуда оно перетекает и куда. */
  function aim(geometry, from, to) {
    const start = shellOf(from);
    const finish = shellOf(to);
    geometry.setAttribute('position', start.position);
    geometry.setAttribute('normal', start.normal);
    geometry.setAttribute('aTarget', finish.position);
    geometry.setAttribute('aTargetNormal', finish.normal);
  }

  return {
    aim,
    take(from, to) {
      const geometry = spare.pop() ?? blank();
      aim(geometry, from, to);
      return geometry;
    },
    give(geometry) {
      spare.push(geometry);
    },
    dispose() {
      for (const geometry of made) geometry.dispose();
      made.length = 0;
      spare.length = 0;
      shells.clear();
    },
  };
}
