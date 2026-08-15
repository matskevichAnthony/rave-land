import { createWalk as createSceneWalk } from '../understav/walk.js';
import { createColliders } from './colliders.js';
import { HALL, VIEW } from './hall.js';
import { CAMERA } from '../config.js';

/**
 * Прогулка по затопленному залу AKHET.
 *
 * Своего кода тут нет: ходьба, оружие, население и гости приходят готовой прогулкой сцены,
 * а этот файл приносит ей зал. Разворот на ложную дверь стоит в `hall.js`, твёрдые тела
 * собирает `colliders.js`.
 */

// Следящая камера встаёт за спиной на своей дальности, и в закрытом зале ей нужно место:
// вход у самой передней стены оставил бы её снаружи, и кадр стал бы чёрным.
const WALL_GAP = 1.5;
const CAMERA_ROOM = CAMERA.startDistance + WALL_GAP;

const [spawnX, , askedZ] = VIEW.walk.position;
const SPAWN = { x: spawnX, z: Math.min(askedZ, HALL.frontZ - CAMERA_ROOM) };

export function createWalk(options) {
  return createSceneWalk({
    ...options,
    spawn: SPAWN,
    facing: VIEW.walk.heading,
    colliders: createColliders,
  });
}
