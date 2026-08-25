/**
 * Объём в карточке: один настоящий 3D-предмет, отрисованный в WebGL и вклеенный в афишу.
 *
 * Рендерер один на страницу и живёт в закрытом холсте: контекстов WebGL у браузера мало,
 * а карточек шесть и они перерисовываются на каждый бросок сида. Кадр статичный, поэтому
 * рендер зовётся один раз на карточку и результат тут же снимается drawImage.
 *
 * Предмет выбирает сид фактуры: узел, осколок или клеть. Все три рисуются рёбрами поверх
 * тёмной заливки: каркас читается чертежом зала, а не пластиковой игрушкой.
 */

import * as THREE from 'three';

const VIEW = 512;
const CAMERA_FOV = 34;
const CAMERA_Z = 3.1;

const KINDS = ['knot', 'shard', 'cage'];

const KNOT_TUBES = [1, 4];
const KNOT_TWISTS = [2, 7];
const SHARD_KICK = 0.34;
const CAGE_BOXES = 3;
const CAGE_STEP = 0.62;

const SIZE_RATIO = [0.38, 0.72];
const CENTRE_X = [0.2, 0.8];
const CENTRE_Y = [0.24, 0.62];
const FILL_ALPHA = 0.72;
const LAYER_ALPHA = 0.92;

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

function buildObject(random, inks) {
  const kind = random.pick(KINDS);
  const group = new THREE.Group();
  const geometries = kind === 'cage'
    ? Array.from({ length: CAGE_BOXES }, (_, ring) => new THREE.BoxGeometry(
      1.6 - ring * CAGE_STEP, 1.6 - ring * CAGE_STEP, 1.6 - ring * CAGE_STEP,
    ))
    : [kind === 'knot' ? knotGeometry(random) : shardGeometry(random)];

  for (const geometry of geometries) {
    const fill = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: new THREE.Color(inks.void),
      transparent: true,
      opacity: FILL_ALPHA,
    }));
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 1),
      new THREE.LineBasicMaterial({ color: new THREE.Color(inks.ember) }),
    );
    group.add(fill, edges);
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
    node.material?.dispose();
  });
}

export function drawDimension(ctx, frame, random, inks) {
  const renderer = getRenderer();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 10);
  camera.position.z = CAMERA_Z;

  const object = buildObject(random, inks);
  scene.add(object);
  renderer.render(scene, camera);

  const size = Math.min(frame.width, frame.height) * random.range(SIZE_RATIO[0], SIZE_RATIO[1]);
  const x = frame.width * random.range(CENTRE_X[0], CENTRE_X[1]) - size / 2;
  const y = frame.height * random.range(CENTRE_Y[0], CENTRE_Y[1]) - size / 2;

  ctx.save();
  ctx.globalAlpha = LAYER_ALPHA;
  ctx.drawImage(renderer.domElement, x, y, size, size);
  ctx.restore();

  disposeObject(object);
  scene.clear();
}
