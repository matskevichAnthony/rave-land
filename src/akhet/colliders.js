import { DOOR, HALL, planColumns, planWalls } from './hall.js';

/**
 * Твёрдое тело сцены AKHET: по залу можно ходить.
 *
 * Ни одного своего числа тут нет. Пол, стены и колоннада приходят из `hall.js` теми же
 * метрами, по которым их строит архитектура, поэтому расстановка не может разъехаться с
 * тем, что видно в кадре. Из двери твёрдыми стоят порог и косяки: об них спотыкаешься,
 * а полотно закрывает торцевая стена.
 *
 * Наносы песка, вода и мелкие твари остаются декорацией: физике они дают только зацепы.
 */

const HALF = 0.5;

// Плита пола толстая намеренно: тонкую насквозь проходит тело, успевшее разогнаться за кадр.
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

/** Дно зала: вода по щиколотку лежит выше, ходят по камню. */
function addFloor(solids) {
  const middleZ = (HALL.frontZ + HALL.endZ) * HALF;
  const halfDepth = (HALL.frontZ - HALL.endZ) * HALF + HALL.wallThickness;
  solids.box(
    [0, HALL.floorY - FLOOR_THICKNESS * HALF, middleZ],
    [HALL.halfWidth + HALL.wallThickness, FLOOR_THICKNESS * HALF, halfDepth],
  );
}

/** Четыре глухие стены: зал закрыт, выйти из него некуда. */
function addWalls(solids) {
  const halfHeight = HALL.roofY * HALF;
  for (const wall of planWalls()) {
    solids.box([wall.x, halfHeight, wall.z], [wall.halfWidth, halfHeight, wall.halfDepth]);
  }
}

/** Колонны стоят там же, где их ставит архитектура: план у обеих один. */
function addColonnade(solids) {
  for (const column of planColumns()) {
    solids.pillar([column.x, column.height * HALF, column.z], column);
  }
}

/**
 * Порог и косяки ложной двери.
 *
 * Полотно уходит в нишу за торцевую стену, и оно уже закрыто её коллайдером. Наружу в зал
 * торчат только порог и два косяка, и спотыкаться можно ровно об них.
 */
function addDoor(solids) {
  const front = HALL.endZ + DOOR.thresholdDepth;
  const back = HALL.endZ - DOOR.nicheDepth - DOOR.leafDepth;
  solids.box(
    [0, DOOR.thresholdHeight * HALF, (front + back) * HALF],
    [DOOR.thresholdHalf, DOOR.thresholdHeight * HALF, (front - back) * HALF],
  );

  const jambFront = HALL.endZ + DOOR.jambDepth;
  const jambBack = HALL.endZ - DOOR.nicheDepth;
  const jambHeight = HALL.roofY - DOOR.thresholdHeight;
  for (const side of [-1, 1]) {
    solids.box(
      [
        side * (DOOR.jambHalf - DOOR.jambWidth * HALF),
        DOOR.thresholdHeight + jambHeight * HALF,
        (jambFront + jambBack) * HALF,
      ],
      [DOOR.jambWidth * HALF, jambHeight * HALF, (jambFront - jambBack) * HALF],
    );
  }
}

export function createColliders({ RAPIER, physicsWorld }) {
  const solids = createSolids({ RAPIER, physicsWorld });

  addFloor(solids);
  addWalls(solids);
  addColonnade(solids);
  addDoor(solids);

  return {
    dispose() {
      for (const body of solids.bodies) physicsWorld.removeRigidBody(body);
      solids.bodies.length = 0;
    },
  };
}
