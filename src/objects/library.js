import * as THREE from 'three';
import { NEON_COLORS } from '../config.js';
import { flatDisc, openBandY } from '../procedural/shapes.js';
import { createSparks } from '../procedural/sparks.js';

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, ...options });
}

function neonMaterial(color, intensity) {
  return new THREE.MeshStandardMaterial({
    color: '#111118',
    emissive: color,
    emissiveIntensity: intensity,
  });
}

function markPulse(mesh, baseIntensity, amplitude, speed, phase) {
  mesh.material.userData.pulse = { baseIntensity, amplitude, speed, phase };
}

function buildHouse(random) {
  const group = new THREE.Group();
  const wallColors = ['#7d4a63', '#4a5d7d', '#5d7d4a', '#7d6a4a'];
  const walls = new THREE.Mesh(
    new THREE.BoxGeometry(4, 3, 4),
    material(wallColors[Math.floor(random() * wallColors.length)]),
  );
  walls.position.y = 1.5;
  group.add(walls);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.2, 2, 4), material('#2f2440'));
  roof.position.y = 4;
  roof.rotation.y = Math.PI / 4;
  group.add(roof);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.1), material('#241a30'));
  door.position.set(0, 0.8, 2.03);
  group.add(door);

  for (const side of [-1.2, 1.2]) {
    const window = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.7, 0.1),
      neonMaterial('#ffe14d', 1.4),
    );
    window.position.set(side, 1.9, 2.03);
    group.add(window);
  }
  return { object: group, collider: null };
}

function buildTree(random) {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.6, 6), material('#4a3628'));
  trunk.position.y = 0.8;
  group.add(trunk);

  const crownColor = new THREE.Color('#35714b').offsetHSL(random() * 0.06 - 0.03, 0, 0);
  const lower = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.6, 7), material(crownColor));
  lower.position.y = 2.6;
  group.add(lower);

  const upper = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2, 7), material(crownColor));
  upper.position.y = 4.2;
  group.add(upper);

  return {
    object: group,
    collider: { halfExtents: [0.35, 1.5, 0.35], offset: [0, 1.5, 0] },
  };
}

function buildSpeaker(random) {
  const group = new THREE.Group();
  const boxMaterial = material('#1c1a26');
  for (const [size, y] of [
    [[1.6, 1.6, 1.2], 0.8],
    [[1.3, 1.3, 1], 2.25],
  ]) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(...size), boxMaterial);
    box.position.y = y;
    group.add(box);
  }
  const neon = NEON_COLORS[Math.floor(random() * NEON_COLORS.length)];
  for (const [radius, y] of [
    [0.5, 0.8],
    [0.35, 2.25],
  ]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.06, 8, 24), neonMaterial(neon, 2.5));
    ring.position.set(0, y, 0.62);
    group.add(ring);
    markPulse(ring, 2.5, 1.5, 6, random() * Math.PI * 2);
  }
  return { object: group, collider: null };
}

function buildDancefloor(random) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.2, 10.4), material('#191624'));
  base.position.y = 0.1;
  group.add(base);

  const tileGeometry = new THREE.BoxGeometry(1.14, 0.08, 1.14);
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const color = NEON_COLORS[Math.floor(random() * NEON_COLORS.length)];
      const tile = new THREE.Mesh(tileGeometry, neonMaterial(color, 1.2));
      tile.position.set(-4.4 + row * 1.26, 0.24, -4.4 + col * 1.26);
      markPulse(tile, 1.2, 1, 2 + random() * 3, random() * Math.PI * 2);
      group.add(tile);
    }
  }
  return { object: group, collider: null };
}

// Витрина в тулбоксе строит объекты без контекста мира, поэтому без света, а не с ошибкой.
function buildLamp(random, context = {}) {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 3.4, 6), material('#2a2735'));
  pole.position.y = 1.7;
  group.add(pole);

  const neon = NEON_COLORS[Math.floor(random() * NEON_COLORS.length)];
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), neonMaterial(neon, 3));
  head.position.y = 3.6;
  group.add(head);
  markPulse(head, 3, 1, 1.5, random() * Math.PI * 2);

  if (context.allowLight) {
    const light = new THREE.PointLight(neon, 30, 22, 1.8);
    light.position.y = 3.6;
    group.add(light);
  }
  return {
    object: group,
    collider: { halfExtents: [0.15, 1.8, 0.15], offset: [0, 1.8, 0] },
  };
}

function buildRock(random) {
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1), material('#55506b'));
  rock.scale.set(0.7 + random() * 0.8, 0.5 + random() * 0.6, 0.7 + random() * 0.8);
  rock.position.y = 0.4;
  const group = new THREE.Group();
  group.add(rock);
  return { object: group, collider: null };
}

const MILLISECONDS = 1000;

const BARREL = {
  radius: 0.31,
  height: 0.92,
  coalRadius: 0.26,
  coalLift: 0.88,
  emissive: 2.2,
  flicker: 1.1,
  flickerSpeed: 7,
  lightPower: 14,
  lightRange: 9,
  sparks: {
    count: 120,
    size: 11,
    jitter: 0.14,
    rise: [1.1, 2.8],
    drift: [0.06, 0.28],
    speed: [0.1, 0.32],
  },
};

/**
 * Горящая бочка: ржавый барабан, угли диском сверху и искры над ними.
 *
 * Барабан открыт с торцов, поэтому материал двусторонний: крышки у бочки нет, её место
 * занимают угли, а дно всё равно стоит на земле и в кадр не попадает.
 */
function buildBarrel(random, context = {}) {
  const group = new THREE.Group();

  const drum = new THREE.Mesh(openBandY(), material('#6a3418', {
    side: THREE.DoubleSide,
    roughness: 1,
  }));
  drum.position.y = BARREL.height / 2;
  drum.scale.set(BARREL.radius, BARREL.height, BARREL.radius);
  group.add(drum);

  const coals = new THREE.Mesh(flatDisc(), new THREE.MeshStandardMaterial({
    color: '#1a0d06',
    emissive: '#ff4d0d',
    emissiveIntensity: BARREL.emissive,
    roughness: 1,
  }));
  coals.position.y = BARREL.height * BARREL.coalLift;
  coals.scale.setScalar(BARREL.coalRadius);
  markPulse(coals, BARREL.emissive, BARREL.flicker, BARREL.flickerSpeed, random() * Math.PI * 2);
  group.add(coals);

  const sparks = createSparks({
    random,
    sources: [[0, BARREL.height, 0]],
    ...BARREL.sparks,
  });
  // Реестр отдаёт кадру только пульс материалов, а шейдеру искр нужно время. Взять его
  // больше негде, поэтому его подаёт рендерер прямо перед отрисовкой точек.
  sparks.object.onBeforeRender = () => sparks.update(performance.now() / MILLISECONDS);
  group.add(sparks.object);

  if (context.allowLight) {
    const light = new THREE.PointLight('#ff6a1e', BARREL.lightPower, BARREL.lightRange, 2);
    light.position.y = BARREL.height;
    group.add(light);
  }

  return {
    object: group,
    collider: {
      halfExtents: [BARREL.radius, BARREL.height / 2, BARREL.radius],
      offset: [0, BARREL.height / 2, 0],
    },
  };
}

export const OBJECT_BUILDERS = {
  house: buildHouse,
  tree: buildTree,
  speaker: buildSpeaker,
  dancefloor: buildDancefloor,
  lamp: buildLamp,
  rock: buildRock,
  barrel: buildBarrel,
};

export const OBJECT_LABELS = {
  house: 'домик',
  tree: 'дерево',
  speaker: 'колонки',
  dancefloor: 'танцпол',
  lamp: 'фонарь',
  rock: 'камень',
  barrel: 'горящая бочка',
  model: 'модель',
};
