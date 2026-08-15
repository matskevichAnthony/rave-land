import RAPIER from '@dimforge/rapier3d-compat';
import { createPlayer } from '../player/player.js';
import { createFollowCamera } from '../player/follow-camera.js';
import { createTouchPad } from '../player/touch-pad.js';
import { input } from '../player/input.js';
import { exitPointerLock } from '../player/pointer-lock.js';
import { createNpcSystem } from '../npc/system.js';
import { createRagdolls } from '../combat/ragdoll.js';
import { createArena } from '../combat/arena.js';
import { createPlayerCombat } from '../combat/weapon.js';
import { createBattleAudio } from '../audio/battle.js';
import { createBattleHud } from '../hud/battle-hud.js';
import { createRandom } from './random.js';
import { PLAYER } from '../config.js';

/**
 * Прогулка по промо-сцене: ходьба, оружие и население берутся из движка, а не пишутся заново.
 *
 * Физика поднимается только здесь, при первом входе в режим: афише она не нужна, а модуль
 * грузится динамическим импортом из `main.js`. Кто именно ходит по сцене, решают данные
 * события, а не этот файл: сюда приходит готовый список моделей.
 *
 * Зал сцена приносит с собой: точка входа, разворот на герой-предмет и твёрдые тела
 * приходят параметрами, а значения по умолчанию описывают неф UNDERSTAV.
 */

const GRAVITY = { x: 0, y: -9.81, z: 0 };

// Пол зала ровный и лежит на нуле, рельефа у сцены нет, но походка, follow-камера, население
// и бой ждут карту высот с габаритами мира: им отдаётся плоская заглушка.
const FLOOR_Y = 0;
const WORLD_SIZE = 160;
const FLAT_FLOOR = { heightAt: () => FLOOR_Y, params: { size: WORLD_SIZE } };

// Перед порталом со стороны кадра афиши: отсюда виден и алтарь, и коридор за спиной.
const SPAWN = { x: 0, z: 16 };
const APPEARANCE = { src: 'assets/models/gta-triad.glb' };
// Игрок ходит в модели триады, значит и фракция его та же: свои не стреляют по своим.
const PLAYER_TEAM = 'triads';
// Алтарь UNDERSTAV стоит в начале координат, поэтому взгляд на него это разворот вдоль -Z.
const HOME_FACING = Math.PI;

const GUEST_SEED = 'ca57';
const GUEST_NAME = 'Гость';
const DEFAULT_CAST = { crowd: 0, radius: [7, 15], teams: [], spawnRadius: 11, pool: [] };
const SPAWNS_PER_TEAM = 3;

// Поза игрока собирается в один объект: новый объект каждый кадр это мусор в горячем месте.
const pose = { aiming: false, aimPitch: 0, shotId: 0, reloadId: 0, weapon: null,
               dead: false, hitT: 0 };

export async function createWalk({
  scene,
  camera,
  renderer,
  grab,
  cast,
  spawn = SPAWN,
  facing = HOME_FACING,
  colliders = null,
}) {
  await RAPIER.init();
  const physicsWorld = new RAPIER.World(GRAVITY);
  const buildColliders = colliders ?? (await loadColliders()).createColliders;
  buildColliders({ RAPIER, physicsWorld });

  // Внешность и точка спавна живут в общем конфиге, потому что `createPlayer` читает его
  // напрямую: своя копия сборки игрока ради двух чисел завела бы вторую правду.
  Object.assign(PLAYER, { spawn, appearance: APPEARANCE, team: PLAYER_TEAM });

  const player = await createPlayer({ RAPIER, physicsWorld, terrain: FLAT_FLOOR, scene });
  const followCam = createFollowCamera(camera, grab, FLAT_FLOOR);
  followCam.snapTo(player.position());
  player.setFacing(facing);

  const npcSystem = createNpcSystem({ scene, camera, terrain: FLAT_FLOOR, renderer });
  const ragdolls = createRagdolls({ RAPIER, physicsWorld, scene });
  const arena = createArena({
    RAPIER,
    physicsWorld,
    scene,
    terrain: FLAT_FLOOR,
    npcSystem,
    ragdolls,
    audio: createBattleAudio({ camera }),
    coverObjects: [],
    playerCollider: player.collider,
  });
  npcSystem.attachArena(arena);

  // Мышь заперта на слое прогулки, значит и клики приходят туда: холст рендерера их не видит,
  // и стрелять было нечем.
  const combat = createPlayerCombat({
    camera,
    domElement: grab,
    player,
    followCam,
    arena,
    npcSystem,
    isEditing: () => false,
  });
  const battleHud = createBattleHud({
    camera,
    scoreboard: arena.scoreboard,
    playerFighter: combat.fighter,
  });

  // Клавиатуры на телефоне нет, а слой захвата это единственное, что там вообще ловит палец:
  // стик и кнопки живут прямо на нём.
  const touchPad = createTouchPad({ root: grab });

  const roster = { ...DEFAULT_CAST, ...cast };
  arena.setSpawns(planSpawns([...roster.teams, PLAYER_TEAM], roster.spawnRadius));
  const rng = createRandom(GUEST_SEED);
  let guests = 0;
  let facingHeld = true;

  /** Гость встаёт кольцом вокруг алтаря: сид держит расстановку повторимой. */
  async function addGuest() {
    if (roster.pool.length === 0) throw new Error('в данных события нет списка моделей гостей');
    const angle = rng() * Math.PI * 2;
    const away = rng.range(...roster.radius);
    guests += 1;
    await npcSystem.add({
      id: crypto.randomUUID(),
      name: `${GUEST_NAME} ${guests}`,
      src: rng.pick(roster.pool),
      seed: Math.floor(rng() * 1e6),
      position: [Math.sin(angle) * away, null, Math.cos(angle) * away],
      // Фракция приходит из данных события: без неё гость мирный и в перестрелку не идёт.
      team: teamFor(roster, guests),
    });
    return guests;
  }

  for (let index = 0; index < roster.crowd; index += 1) await addGuest();

  /** Пад вливается в тот же ввод, что и клавиатура: одно намерение на оба источника. */
  function pourTouch() {
    const look = touchPad.takeLook();
    followCam.dragLook(look.dx, look.dy);
    input.setPad({ x: touchPad.axes.x, z: touchPad.axes.y, jump: touchPad.buttons.jump });
    combat.setPadButtons(touchPad.buttons);
  }

  function update(dt) {
    if (touchPad.available) pourTouch();
    const { fighter } = combat;
    const aiming = combat.armed;
    followCam.setAiming(aiming);
    // До первого шага персонаж держит лицо к алтарю, дальше разворотом правит ход или прицел.
    if (facingHeld && player.speed() > 0) facingHeld = false;
    player.setFacing(aiming ? followCam.azimuth() + Math.PI : (facingHeld ? facing : null));
    pose.aiming = aiming;
    pose.aimPitch = followCam.aimPitch();
    pose.shotId = fighter.shotId;
    pose.reloadId = fighter.reloadId;
    pose.weapon = fighter.weapon;
    pose.dead = !fighter.alive;
    pose.hitT = fighter.hitT;

    player.move(dt, followCam.azimuth(), pose);
    physicsWorld.timestep = dt;
    physicsWorld.step();
    player.sync();
    ragdolls.update(dt);
    combat.update(dt);
    arena.update(dt);
    battleHud.update(dt);
    npcSystem.update(dt);
    followCam.follow(player.mesh.position);
  }

  function setActive(active) {
    // В снимаемых кадрах ни игрока, ни гостей быть не должно, а мышь в других режимах
    // принадлежит свободной камере: слой захвата уходит вместе с ними.
    player.mesh.visible = active;
    for (const object of npcSystem.objects) object.visible = active;
    grab.hidden = !active;
    battleHud.setActive(active && arena.active);
    touchPad.setActive(active);
    if (!active) exitPointerLock();
  }

  setActive(false);
  return {
    update,
    setActive,
    addGuest,
    toggleBattle() {
      arena.toggle();
      battleHud.setActive(arena.active);
      return arena.active;
    },
  };
}

/** Гости раздаются по фракциям по кругу: две команды дают перестрелку, одна дала бы дружбу. */
function teamFor(roster, index) {
  if (roster.teams.length === 0) return undefined;
  return roster.teams[(index - 1) % roster.teams.length];
}

/**
 * Точки возрождения по фракциям, кольцом вокруг алтаря.
 *
 * Без них убитый боец встаёт там, где упал, и перестрелка вырождается в толкучку на одном
 * пятачке. Числа выводятся из тех же данных, что и расстановка гостей.
 */
function planSpawns(teams, radius) {
  const points = [];
  teams.forEach((team, teamIndex) => {
    for (let index = 0; index < SPAWNS_PER_TEAM; index += 1) {
      const share = (teamIndex + index / SPAWNS_PER_TEAM) / teams.length;
      const angle = share * Math.PI * 2;
      points.push({ team, x: Math.sin(angle) * radius, z: Math.cos(angle) * radius });
    }
  });
  return points;
}

async function loadColliders() {
  const module = await import('./colliders.js').catch((error) => {
    throw new Error(`colliders.js не загрузился: ${error.message}`);
  });
  if (typeof module.createColliders !== 'function') {
    throw new Error('colliders.js без выхода createColliders');
  }
  return module;
}
