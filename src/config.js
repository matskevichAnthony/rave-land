export const TERRAIN_DEFAULTS = {
  seed: 7,
  size: 160,
  resolution: 120,
  amplitude: 12,
  plateauRadius: 18,
};

export const PLAYER = {
  strollSpeed: 1.6,
  walkSpeed: 4.5,
  runSpeed: 8.5,
  // Со стволом наизготовку в San Andreas ходят, а не бегают. Это авторская скорость клипов
  // GunMove_* (замер по ped.ifp), weapon.dat домножает её своим moveSpeed.
  aimSpeed: 1.85,
  jumpSpeed: 8,
  gravity: -24,
  spawn: { x: 0, z: 21 },
  appearance: { src: 'assets/models/gta-ballas.glb' },
  // Игрок ходит в модели Ballas, поэтому и фракция его та же: свои не стреляют по своим.
  team: 'ballas',
  name: 'Ты',
};

/**
 * Числа перестрелки. Всё, что подбирается на глаз, живёт здесь, а не в модулях боя.
 *
 * Урон, дальность, магазин и точность сюда не входят: они приходят из weapon.dat через
 * `combat/weapons.js`, и дублировать их своими константами значит завести вторую правду.
 */
export const COMBAT = {
  // Бой считается фиксированным шагом, отдельно от кадра: попадания и разброс не должны
  // зависеть от того, сколько кадров выдала машина.
  stepSeconds: 1 / 30,
  maxHp: 100,
  respawnSeconds: 5,
  reloadSeconds: 1.6,
  reserveMagazines: 5,
  minReserve: 24,
  // Реакция на попадание это таймер, а не состояние: она не отбирает управление.
  flinchSeconds: 0.35,
  // Зоны считаются от высоты попадания над стопами, отдельных коллайдеров на части тела нет.
  zones: [
    { id: 'head', above: 0.88, factor: 3, name: 'в голову' },
    { id: 'torso', above: 0.55, factor: 1, name: 'в корпус' },
    { id: 'legs', above: -Infinity, factor: 0.6, name: 'в ноги' },
  ],
  // Габарит бойца для луча: капсула от стоп до макушки.
  bodyRadius: 0.32,
  bodyHeight: 1.75,
  eyeHeight: 1.6,
  chestHeight: 1.2,
  // Разброс на дистанции: угол в градусах при точности 1.0 из weapon.dat. Вертикальный вдвое
  // меньше горизонтального, потому что промах вбок читается, а промах в небо выглядит багом.
  spreadDegrees: 2.2,
  verticalSpreadShare: 0.5,
  movingSpreadFactor: 2,
  freshTargetSpreadFactor: 1.5,
  freshTargetSeconds: 0.5,
  // Игрок целится сам, поэтому его разброс задаёт только манеру ствола, а не мажет за него.
  playerSpreadFactor: 0.35,
  // Скорость, выше которой боец считается идущим: она портит кучность и запрещает целиться
  // оружию без флага MOVEAIM.
  movingThreshold: 0.6,
  // А вот огонь оружие без MOVEFIRE теряет только на бегу. Порог отдельный, потому что с
  // поднятым стволом ходят на 1.85 м/с: по общему порогу стрелять было бы нельзя вообще
  // никогда, кроме полной остановки, и это читалось как сломанная мышь.
  runningThreshold: 3,
};

export const BOT = {
  viewRange: 40,
  fieldOfView: Math.PI * 2 / 3,
  // По кому недавно стреляли, тот смотрит на все стороны: перестрелка должна затягивать.
  alertSeconds: 4,
  // Луч видимости идёт по бюджету на шаг, а не «каждый в каждого»: цена не зависит от числа.
  sightRaysPerStep: 4,
  reactionSeconds: 0.35,
  burst: { min: 2, max: 3, autoMin: 5, autoMax: 7 },
  burstPauseSeconds: { min: 0.6, max: 1.2 },
  // Липкость цели: без неё бот дёргается между двумя врагами и не попадает ни в кого.
  targetHoldSeconds: 2.5,
  keepDistance: { near: 7, far: 18 },
  coverRadius: 14,
  coverHoldSeconds: 3,
  retreatHpShare: 0.3,
  strafeSeconds: { min: 1.2, max: 2.6 },
  arriveRadius: 1.2,
  // Уперся в стену и не едет, значит обходить: направление доворачивается вбок на время.
  stuckSeconds: 0.5,
  stuckProgress: 0.3,
  sidestepSeconds: 1.1,
  sidestepAngle: Math.PI / 3,
};

export const CAMERA = {
  fov: 60,
  near: 0.1,
  far: 700,
  followHeight: 1.4,
  startDistance: 9,
};

export const BLOOM = {
  strength: 0.55,
  radius: 0.4,
  threshold: 0.85,
};

export const MAX_LAMP_LIGHTS = 8;

export const NEON_COLORS = ['#ff2fd6', '#00ffd0', '#7b5cff', '#ffe14d', '#00a8ff'];

export const STORAGE_KEY = 'rave-land-world';
