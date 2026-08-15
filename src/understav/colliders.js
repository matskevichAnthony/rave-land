import { CORRIDOR, EMBER_RING, NAVE } from './nave.js';

/**
 * Твёрдое тело промо-сцены UNDERSTAV: по залу и коридору можно ходить.
 *
 * Коллайдер получает только то, обо что честно спотыкаешься: пол, стены, колоннада зала,
 * пилястры и колонны коридора, алтарь со ступенями и жаровни на кольце углей. Цепи, крюки,
 * лужи, обломки и подвешенный хлам остаются декорацией: физике они дают только зацепы.
 */

const HALF = 0.5;

/**
 * Метры расстановки, которых нет в `nave.js`.
 *
 * Они лежат приватными константами в `architecture.js`, а тот правит другой процесс, поэтому
 * импортировать их неоткуда. Это копия, и менять её надо вместе с оригиналом.
 */
const PYLON = { width: 1.7, jitterX: 0.35, startZ: 6, endZ: -18, shortest: 4.8 };
const CORRIDOR_COLUMN = { x: 5.4, radius: 0.5, height: 6.6 };
const ALTAR_STEPS = { count: 3, depth: 0.85, width: 3.4, taper: 0.35 };
const BARREL = { radius: 0.45, height: 1.1, jitter: 0.9 };

const WALL_THICKNESS = 0.5;
// Плита толстая намеренно: тонкую насквозь проходит тело, успевшее разогнаться за кадр.
const FLOOR_THICKNESS = 2;

function createSolids({ RAPIER, physicsWorld }) {
  const bodies = [];

  function put(descriptor, [x, y, z]) {
    const body = physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z),
    );
    physicsWorld.createCollider(descriptor, body);
    bodies.push(body);
    return body;
  }

  return {
    bodies,
    box: (center, [hx, hy, hz]) => put(RAPIER.ColliderDesc.cuboid(hx, hy, hz), center),
    pillar: (center, { radius, height }) => put(
      RAPIER.ColliderDesc.cylinder(height * HALF, radius),
      center,
    ),
  };
}

/** Мир от торца за розой до дальнего конца коридора: пол и четыре глухие стены. */
function addBounds(solids) {
  const back = NAVE.endZ;
  const front = CORRIDOR.farZ;
  const middle = (back + front) * HALF;
  const halfLength = (front - back) * HALF;
  const half = WALL_THICKNESS * HALF;

  solids.box([0, -FLOOR_THICKNESS * HALF, middle],
    [NAVE.halfWidth, FLOOR_THICKNESS * HALF, halfLength]);

  const wallHalfHeight = NAVE.vaultHeight * HALF;
  for (const side of [-1, 1]) {
    solids.box([side * (NAVE.halfWidth + half), wallHalfHeight, middle],
      [half, wallHalfHeight, halfLength]);
  }
  solids.box([0, wallHalfHeight, back - half], [NAVE.halfWidth, wallHalfHeight, half]);
  solids.box([0, wallHalfHeight, front + half], [NAVE.halfWidth, wallHalfHeight, half]);
}

/**
 * Колоннада зала стоит сплошной преградой, а не столбами по одному.
 *
 * Пилоны расставляет сид: их число берётся из диапазона, а каждый ещё и сдвинут случайно,
 * поэтому повторить расстановку по числам нельзя. Столб на угаданном месте это либо
 * невидимая стена в пролёте, либо пилон, сквозь который проходишь насквозь. Полоса вдоль
 * ряда честнее: игрока останавливает та самая линия, которую он видит, а боковые нефы за
 * ней всё равно пусты и с камеры не читаются.
 */
function addColonnade(solids) {
  const halfDepth = Math.abs(PYLON.startZ - PYLON.endZ) * HALF;
  const centerZ = (PYLON.startZ + PYLON.endZ) * HALF;
  const halfWidth = PYLON.width * HALF + PYLON.jitterX;
  for (const side of [-1, 1]) {
    solids.box([side * NAVE.colonnadeHalfWidth, PYLON.shortest * HALF, centerZ],
      [halfWidth, PYLON.shortest * HALF, halfDepth]);
  }
}

/** Пролёты коридора: шаг и число считаются так же, как их считает расстановка. */
function corridorBays() {
  const first = NAVE.frontZ + CORRIDOR.span;
  const count = Math.floor((CORRIDOR.farZ - first) / CORRIDOR.span) + 1;
  return Array.from({ length: count }, (_, index) => first + index * CORRIDOR.span);
}

function addCorridor(solids) {
  const pier = CORRIDOR.pier;
  const pierHeight = CORRIDOR.arch.lift;
  for (const z of corridorBays()) {
    for (const side of [-1, 1]) {
      solids.box([side * pier.x, pierHeight * HALF, z],
        [pier.width * HALF, pierHeight * HALF, pier.depth * HALF]);
      solids.pillar([side * CORRIDOR_COLUMN.x, CORRIDOR_COLUMN.height * HALF, z],
        CORRIDOR_COLUMN);
    }
  }
}

/** Платформа алтаря и лестница к ней: без ступеней на неё оставалось бы только запрыгивать. */
function addAltar(solids) {
  solids.pillar([0, NAVE.altarHeight * HALF, 0],
    { radius: NAVE.altarRadius, height: NAVE.altarHeight });

  for (let index = 0; index < ALTAR_STEPS.count; index += 1) {
    const height = (NAVE.altarHeight * (index + 1)) / ALTAR_STEPS.count;
    const z = NAVE.altarRadius + ALTAR_STEPS.depth * (ALTAR_STEPS.count - index - HALF);
    solids.box([0, height * HALF, z],
      [(ALTAR_STEPS.width - index * ALTAR_STEPS.taper) * HALF, height * HALF,
        ALTAR_STEPS.depth * HALF]);
  }
}

/**
 * Жаровни на закреплённых углах кольца.
 *
 * Остальные бочки сид расставляет по случайным углам и часть выбрасывает, так что твёрдыми
 * стоят только две, на которые смотрят точечные источники. Радиус взят с запасом на разброс
 * по кольцу: иначе бочка уезжает из своего коллайдера почти на диаметр.
 */
function addEmberBarrels(solids) {
  for (const angle of EMBER_RING.anchors) {
    solids.pillar(
      [Math.cos(angle) * EMBER_RING.radius, BARREL.height * HALF,
        Math.sin(angle) * EMBER_RING.radius],
      { radius: BARREL.radius + BARREL.jitter, height: BARREL.height },
    );
  }
}

export function createColliders({ RAPIER, physicsWorld }) {
  const solids = createSolids({ RAPIER, physicsWorld });

  addBounds(solids);
  addColonnade(solids);
  addCorridor(solids);
  addAltar(solids);
  addEmberBarrels(solids);

  return {
    dispose() {
      for (const body of solids.bodies) physicsWorld.removeRigidBody(body);
      solids.bodies.length = 0;
    },
  };
}
