import * as THREE from 'three';
import { input } from './input.js';
import { buildCharacter } from '../characters/builder.js';
import { buildGltfCharacter } from '../npc/gltf-character.js';
import { PLAYER } from '../config.js';

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HALF_HEIGHT = 0.55;
const BODY_CENTER_Y = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
const LANDING_SECONDS = 0.23;
const TURN_RATE = 12;
// Мирная поза для редактора: оружия нет, стрельбы нет, счётчики стоят.
const IDLE_COMBAT = { aiming: false, aimPitch: 0, shotId: 0, reloadId: 0, weapon: null,
                      dead: false, hitT: 0 };

/** Кратчайшая разница двух азимутов, со знаком. */
function angleDiff(target, current) {
  const diff = target - current;
  return Math.atan2(Math.sin(diff), Math.cos(diff));
}

export async function createPlayer({ RAPIER, physicsWorld, terrain, scene }) {
  const character = PLAYER.appearance.src
    ? await buildGltfCharacter(PLAYER.appearance.src)
    : buildCharacter(PLAYER.appearance);
  const mesh = character.object;
  scene.add(mesh);

  const spawnY = terrain.heightAt(PLAYER.spawn.x, PLAYER.spawn.z) + BODY_CENTER_Y + 0.5;
  const body = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      PLAYER.spawn.x,
      spawnY,
      PLAYER.spawn.z,
    ),
  );
  const collider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.capsule(CAPSULE_HALF_HEIGHT, CAPSULE_RADIUS),
    body,
  );

  const controller = physicsWorld.createCharacterController(0.02);
  controller.enableAutostep(0.5, 0.2, true);
  controller.enableSnapToGround(0.5);

  let verticalVelocity = 0;
  let yaw = 0;
  let facingOverride = null;
  let airTime = 0;
  let landingLeft = 0;
  let planarSpeed = 0;
  const moveDirection = new THREE.Vector3();
  const localMove = new THREE.Vector3();
  // Поза живёт одна на всё время: аниматор читает её каждый кадр, а заводить объект в кадре
  // значит кормить мусорщик.
  const pose = { speed: 0, aiming: false, moveDir: { x: 0, z: 1 }, airborne: false, jumpTime: 0,
                 landing: false, aimYaw: 0, aimPitch: 0, shotId: 0, reloadId: 0, weapon: null,
                 dead: false, hitT: 0 };

  function turnToward(targetYaw, dt) {
    yaw += angleDiff(targetYaw, yaw) * Math.min(1, dt * TURN_RATE);
  }

  /**
   * Поза для аниматора: движение в системе персонажа, фазы прыжка, углы наведения.
   *
   * aimYaw это остаток разворота: ноги догоняют азимут камеры с ограниченной скоростью, а
   * разницу отыгрывают корпус и рука, иначе ствол всё время смотрит мимо цели. Счётчики
   * выстрела и перезарядки приходят из реестра бойцов: патроны считает бой, а не походка.
   */
  function poseFor(speed, combat) {
    localMove.copy(moveDirection).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
    const length = Math.hypot(localMove.x, localMove.z) || 1;
    pose.speed = speed;
    pose.aiming = combat.aiming;
    pose.moveDir.x = localMove.x / length;
    pose.moveDir.z = localMove.z / length;
    pose.airborne = airTime > 0;
    pose.jumpTime = airTime;
    pose.landing = landingLeft > 0;
    pose.aimYaw = facingOverride === null ? 0 : angleDiff(facingOverride, yaw);
    pose.aimPitch = combat.aimPitch;
    pose.shotId = combat.shotId;
    pose.reloadId = combat.reloadId;
    pose.weapon = combat.weapon;
    pose.dead = combat.dead;
    pose.hitT = combat.hitT;
    return pose;
  }

  /**
   * Скорость с учётом оружия в руках.
   *
   * Прицельный шаг режется до темпа клипов GunMove_*, и его домножает moveSpeed из
   * weapon.dat. Бег остаётся бегом: в San Andreas ствол наизготовку мешает ходить, а не
   * бегать, и на бегу играет свой клип.
   */
  function speedFor(combat) {
    const gait = input.gait();
    const speed = PLAYER[gait];
    if (!combat.aiming || gait === 'runSpeed') return speed;
    return Math.min(speed, PLAYER.aimSpeed * (combat.weapon?.moveSpeedFactor ?? 1));
  }

  function move(dt, cameraAzimuth, combat) {
    const { x, z } = input.axis();
    const speed = combat.dead ? 0 : speedFor(combat);

    const forwardX = -Math.sin(cameraAzimuth);
    const forwardZ = -Math.cos(cameraAzimuth);
    moveDirection
      .set(forwardX * z + -forwardZ * x, 0, forwardZ * z + forwardX * x)
      .normalize()
      .multiplyScalar(x || z ? speed * dt : 0);

    const groundedBefore = controller.computedGrounded();
    if (groundedBefore && input.isDown('Space')) {
      verticalVelocity = PLAYER.jumpSpeed;
      airTime = Number.EPSILON;
    }
    verticalVelocity += PLAYER.gravity * dt;

    controller.computeColliderMovement(collider, {
      x: moveDirection.x,
      y: verticalVelocity * dt,
      z: moveDirection.z,
    });
    const grounded = controller.computedGrounded();
    if (grounded && verticalVelocity < 0) verticalVelocity = 0;
    if (grounded && airTime > 0) landingLeft = LANDING_SECONDS;
    airTime = grounded ? 0 : airTime + dt;
    landingLeft = Math.max(0, landingLeft - dt);

    const movement = controller.computedMovement();
    const current = body.translation();
    body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });

    // Разворот идёт до позы, а не после: остаток, который уходит в aimYaw, должен быть
    // сегодняшним, иначе ствол отстаёт от камеры на кадр.
    if (facingOverride !== null) {
      turnToward(facingOverride, dt);
    } else if (moveDirection.lengthSq() > 0) {
      turnToward(Math.atan2(moveDirection.x, moveDirection.z), dt);
    }
    planarSpeed = dt > 0 ? Math.hypot(movement.x, movement.z) / dt : 0;
    character.update(dt, poseFor(planarSpeed, combat));
  }

  function sync() {
    const position = body.translation();
    if (position.y < -60) {
      teleport(PLAYER.spawn.x, PLAYER.spawn.z);
      return;
    }
    mesh.position.set(position.x, position.y - BODY_CENTER_Y, position.z);
    mesh.rotation.y = yaw;
  }

  function idle(dt) {
    moveDirection.set(0, 0, 0);
    planarSpeed = 0;
    character.update(dt, poseFor(0, IDLE_COMBAT));
  }

  function teleport(x, z) {
    const y = terrain.heightAt(x, z) + BODY_CENTER_Y + 0.5;
    body.setNextKinematicTranslation({ x, y, z });
    verticalVelocity = 0;
  }

  return {
    mesh,
    collider,
    move,
    sync,
    idle,
    teleport,
    setFacing: (value) => {
      facingOverride = value;
    },
    // Тело игрока стоит в физике капсулой, а зоны попадания считаются от стоп: разница нужна
    // и реестру бойцов, и тому, кто рисует.
    feetOffset: BODY_CENTER_Y,
    speed: () => planarSpeed,
    position: () => body.translation(),
  };
}
