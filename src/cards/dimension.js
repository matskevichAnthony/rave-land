/**
 * Объём в карточке: настоящий генеративный 3D-предмет, отрисованный в WebGL и вклеенный
 * в афишу.
 *
 * Рендерер один на страницу и живёт в закрытом холсте: контекстов WebGL у браузера мало,
 * а карточек шесть и они перерисовываются на каждый бросок сида. Кадр статичный, поэтому
 * рендер зовётся один раз на карточку и результат тут же снимается drawImage.
 *
 * Предметов шесть, и половина из них не нарисована, а выращена: капля продавлена
 * трёхмерным шумом по нормалям, лента идёт трубой по случайному блужданию, башня скручена
 * этажами. Кожа тоже сидовая: каркас чертежа, цветной нормальный материал, глитч-текстура,
 * рисуемая по пикселям на холсте, или облако вершин точками. На один и тот же предмет
 * разные сиды надевают разную кожу, и предсказать сочетание до броска нельзя, а повторить
 * после можно всегда.
 */

import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';

const VIEW = 512;
const CAMERA_FOV = 34;
const CAMERA_Z = 3.1;

const KINDS = ['knot', 'shard', 'cage', 'blob', 'ribbon', 'stack'];
const SKINS = ['wire', 'facet', 'glitch', 'points'];

// Фасеточная кожа: доля тени в рампе и разброс направления света.
const FACET_SHADOW = 0.85;

const KNOT_TUBES = [1, 4];
const KNOT_TWISTS = [2, 7];
const SHARD_KICK = 0.34;
const CAGE_BOXES = 3;
const CAGE_STEP = 0.62;

// Капля: сила продавливания шумом и его частота.
const BLOB_DETAIL = 4;
const BLOB_WARP = [0.18, 0.55];
const BLOB_FREQ = [0.8, 2.6];

// Лента: сколько узлов у блуждания и толщина трубы.
const RIBBON_POINTS = [5, 9];
const RIBBON_RADIUS = [0.05, 0.16];
const RIBBON_SEGMENTS = 140;
const RIBBON_SPAN = 0.9;

// Башня: этажи, шаг скрутки и сужение кверху.
const STACK_FLOORS = [6, 14];
const STACK_TWIST = [0.1, 0.5];
const STACK_BASE = 1.1;
const STACK_TAPER = [0.4, 0.9];
const STACK_FLOOR_HEIGHT = 0.16;

// Глитч-кожа: размер пиксельной текстуры и плотность помех.
const GLITCH_SIZE = 64;
const GLITCH_ROWS = [6, 18];
const GLITCH_NOISE = 0.22;

const POINT_SIZE = [0.015, 0.05];

/**
 * Тон объёма: своя палитра 3D, отвязанная от красок серии по выбору пульта.
 * Жар и холод берут глобальные цвета, металл и моно глушат предмет в серость и кость:
 * так объём не может самовольно вытечь в цвет, который портит всю серию.
 */
function tonePalette(tone, inks) {
  if (tone === 'cold') return { lit: inks.moon, alt: inks.trip, dust: inks.bone };
  if (tone === 'metal') return { lit: inks.concrete, alt: inks.iron, dust: inks.bone };
  if (tone === 'mono') return { lit: inks.bone, alt: inks.concrete, dust: inks.bone };
  return { lit: inks.ember, alt: inks.blood, dust: inks.bone };
}

const SIZE_RATIO = [0.38, 0.72];
const CENTRE_X = [0.2, 0.8];
const CENTRE_Y = [0.24, 0.62];
const FILL_ALPHA = 0.72;
const LAYER_ALPHA = 0.92;

// Эхо: вторая проекция того же кадра со сносом, вжатая сложением.
const ECHO_ODDS = 0.45;
const ECHO_OFFSET_UNITS = [0.8, 3];
const ECHO_ALPHA = 0.4;

let shared = null;

function getRenderer() {
  if (!shared) {
    shared = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    shared.setSize(VIEW, VIEW, false);
    shared.setClearColor(0x000000, 0);
  }
  return shared;
}

function knotGeometry(random) {
  return new THREE.TorusKnotGeometry(
    0.72, 0.2, 130, 10,
    random.int(KNOT_TUBES[0], KNOT_TUBES[1]),
    random.int(KNOT_TWISTS[0], KNOT_TWISTS[1]),
  );
}

/** Осколок: икосаэдр, у которого каждая вершина сбита шумом сида со своего места. */
function shardGeometry(random) {
  const geometry = new THREE.IcosahedronGeometry(0.9, 1);
  const position = geometry.getAttribute('position');
  for (let at = 0; at < position.count; at += 1) {
    position.setXYZ(
      at,
      position.getX(at) * (1 + random.range(-SHARD_KICK, SHARD_KICK)),
      position.getY(at) * (1 + random.range(-SHARD_KICK, SHARD_KICK)),
      position.getZ(at) * (1 + random.range(-SHARD_KICK, SHARD_KICK)),
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Капля: сфера, продавленная трёхмерным симплекс-шумом вдоль нормалей. */
function blobGeometry(random) {
  const noise = createNoise3D(random);
  const warp = random.range(BLOB_WARP[0], BLOB_WARP[1]);
  const freq = random.range(BLOB_FREQ[0], BLOB_FREQ[1]);
  const geometry = new THREE.IcosahedronGeometry(0.85, BLOB_DETAIL);
  const position = geometry.getAttribute('position');
  const point = new THREE.Vector3();
  for (let at = 0; at < position.count; at += 1) {
    point.set(position.getX(at), position.getY(at), position.getZ(at));
    const kick = 1 + noise(point.x * freq, point.y * freq, point.z * freq) * warp;
    position.setXYZ(at, point.x * kick, point.y * kick, point.z * kick);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** Лента: труба по сглаженному случайному блужданию внутри куба. */
function ribbonGeometry(random) {
  const count = random.int(RIBBON_POINTS[0], RIBBON_POINTS[1]);
  const points = Array.from({ length: count }, () => new THREE.Vector3(
    random.range(-RIBBON_SPAN, RIBBON_SPAN),
    random.range(-RIBBON_SPAN, RIBBON_SPAN),
    random.range(-RIBBON_SPAN, RIBBON_SPAN),
  ));
  const curve = new THREE.CatmullRomCurve3(points, random() < 0.5);
  return new THREE.TubeGeometry(
    curve, RIBBON_SEGMENTS,
    random.range(RIBBON_RADIUS[0], RIBBON_RADIUS[1]),
    8, false,
  );
}

/** Башня: этажи-плиты, каждый повёрнут и уже предыдущего. */
function stackGeometries(random) {
  const floors = random.int(STACK_FLOORS[0], STACK_FLOORS[1]);
  const twist = random.range(STACK_TWIST[0], STACK_TWIST[1]) * random.sign();
  const taper = random.range(STACK_TAPER[0], STACK_TAPER[1]);
  return Array.from({ length: floors }, (_, floor) => {
    const side = STACK_BASE * (1 - (1 - taper) * (floor / floors));
    const geometry = new THREE.BoxGeometry(side, STACK_FLOOR_HEIGHT, side);
    geometry.rotateY(twist * floor);
    geometry.translate(0, (floor - floors / 2) * STACK_FLOOR_HEIGHT * 1.35, 0);
    return geometry;
  });
}

/** Глитч-текстура: пиксельные ряды тона с помехами, рисуются на плоском холсте. */
function glitchTexture(random, inks, tone) {
  const canvas = document.createElement('canvas');
  canvas.width = GLITCH_SIZE;
  canvas.height = GLITCH_SIZE;
  const ctx = canvas.getContext('2d');
  const palette = [inks.void, tone.lit, tone.alt, tone.dust];
  const rows = random.int(GLITCH_ROWS[0], GLITCH_ROWS[1]);
  const rowHeight = GLITCH_SIZE / rows;
  for (let row = 0; row < rows; row += 1) {
    ctx.fillStyle = random.pick(palette);
    ctx.fillRect(0, row * rowHeight, GLITCH_SIZE, rowHeight);
    const shards = random.int(1, 5);
    for (let shard = 0; shard < shards; shard += 1) {
      ctx.fillStyle = random.pick(palette);
      ctx.fillRect(
        random.range(0, GLITCH_SIZE), row * rowHeight,
        random.range(2, GLITCH_SIZE * 0.4), rowHeight,
      );
    }
  }
  for (let speck = 0; speck < GLITCH_SIZE * GLITCH_SIZE * GLITCH_NOISE; speck += 1) {
    ctx.fillStyle = random.pick(palette);
    ctx.fillRect(random.int(0, GLITCH_SIZE - 1), random.int(0, GLITCH_SIZE - 1), 1, 1);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Фасеточная кожа: каждая грань выкрашена вручную по своей нормали рампой из красок
 * серии, тень уходит в чернильную тьму. Спектральный MeshNormalMaterial здесь запрещён:
 * его радуга не знает про глобальные цвета пульта и вываливает предмет из серии.
 */
function facetSkin(geometry, random, inks, tone) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  // Развёрнутая копия замещает исходник: тот больше никому не виден, чистится сразу.
  if (flat !== geometry) geometry.dispose();
  const position = flat.getAttribute('position');
  const normal = flat.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  const light = new THREE.Vector3(random.range(-1, 1), random.range(0.2, 1), random.range(0.4, 1)).normalize();
  const lit = new THREE.Color(tone.lit);
  const dark = new THREE.Color(inks.void);
  const face = new THREE.Vector3();
  const shade = new THREE.Color();
  for (let corner = 0; corner < position.count; corner += 3) {
    face.set(normal.getX(corner), normal.getY(corner), normal.getZ(corner));
    const tone = Math.max(0, face.dot(light));
    shade.copy(dark).lerp(lit, 1 - FACET_SHADOW + tone * FACET_SHADOW);
    for (let point = 0; point < 3; point += 1) {
      colors.set([shade.r, shade.g, shade.b], (corner + point) * 3);
    }
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(flat, new THREE.MeshBasicMaterial({ vertexColors: true }));
}

/** Кожа предмета: во что одета геометрия решает сид, а цвет держит тон пульта. */
function dress(geometry, skin, random, inks, tone) {
  if (skin === 'points') {
    return new THREE.Points(geometry, new THREE.PointsMaterial({
      color: new THREE.Color(random.pick([tone.lit, tone.alt, tone.dust])),
      size: random.range(POINT_SIZE[0], POINT_SIZE[1]),
    }));
  }
  if (skin === 'facet') {
    return facetSkin(geometry, random, inks, tone);
  }
  if (skin === 'glitch') {
    return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: glitchTexture(random, inks, tone) }));
  }
  const group = new THREE.Group();
  const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: new THREE.Color(inks.void),
    transparent: true,
    opacity: FILL_ALPHA,
  }));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 1),
    new THREE.LineBasicMaterial({ color: new THREE.Color(tone.lit) }),
  );
  group.add(fill, edges);
  return group;
}

function buildObject(random, inks, tone) {
  const kind = random.pick(KINDS);
  const skin = random.pick(SKINS);
  const group = new THREE.Group();

  const geometries = (() => {
    if (kind === 'cage') {
      return Array.from({ length: CAGE_BOXES }, (_, ring) => new THREE.BoxGeometry(
        1.6 - ring * CAGE_STEP, 1.6 - ring * CAGE_STEP, 1.6 - ring * CAGE_STEP,
      ));
    }
    if (kind === 'stack') return stackGeometries(random);
    if (kind === 'blob') return [blobGeometry(random)];
    if (kind === 'ribbon') return [ribbonGeometry(random)];
    return [kind === 'knot' ? knotGeometry(random) : shardGeometry(random)];
  })();

  for (const geometry of geometries) {
    group.add(dress(geometry, skin, random, inks, tone));
  }

  group.rotation.set(
    random.range(0, Math.PI * 2),
    random.range(0, Math.PI * 2),
    random.range(0, Math.PI * 2),
  );
  return group;
}

function disposeObject(group) {
  group.traverse((node) => {
    node.geometry?.dispose();
    if (node.material) {
      node.material.map?.dispose();
      node.material.dispose();
    }
  });
}

export function drawDimension(ctx, frame, random, inks, { tone = 'heat', alpha = LAYER_ALPHA } = {}) {
  const renderer = getRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 10);
  camera.position.z = CAMERA_Z;

  const palette = tonePalette(tone, inks);
  const object = buildObject(random, inks, palette);
  scene.add(object);
  renderer.render(scene, camera);

  const size = Math.min(frame.width, frame.height) * random.range(SIZE_RATIO[0], SIZE_RATIO[1]);
  const x = frame.width * random.range(CENTRE_X[0], CENTRE_X[1]) - size / 2;
  const y = frame.height * random.range(CENTRE_Y[0], CENTRE_Y[1]) - size / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(renderer.domElement, x, y, size, size);
  // Эхо: тот же кадр со сносом ложится сложением, предмет двоится каналом, а не копией.
  if (random() < ECHO_ODDS) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ECHO_ALPHA * alpha;
    const drift = frame.unit * random.range(ECHO_OFFSET_UNITS[0], ECHO_OFFSET_UNITS[1]);
    ctx.drawImage(renderer.domElement, x + drift * random.sign(), y + drift * random.sign(), size, size);
  }
  ctx.restore();

  disposeObject(object);
  scene.clear();
}
