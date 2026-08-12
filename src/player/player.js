import * as THREE from 'three';
import { input } from './input.js';
import { buildCharacter } from '../characters/builder.js';
import { buildGltfCharacter } from '../npc/gltf-character.js';
import { PLAYER } from '../config.js';

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HALF_HEIGHT = 0.55;
const BODY_CENTER_Y = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;
const LANDING_SECONDS = 0.23;
const RECOIL_SECONDS = 0.18;
// Длительность клипа стрельбы из colt45.ifp: слой держится ровно столько.
const FIRE_SECONDS = 0.73;

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
  let recoilLeft = 0;
  let fireLeft = 0;
  let shotId = 0;
  let weapon = null;
  const moveDirection = new THREE.Vector3();
  const localMove = new THREE.Vector3();

  function turnToward(targetYaw, dt) {
    let diff = targetYaw - yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    yaw += diff * Math.min(1, dt * 12);
  }

  /** Поза для аниматора: движение в системе персонажа, фазы прыжка, углы наведения. */
  function poseFor(dt, speed, aiming, aimPitch) {
    localMove.copy(moveDirection).applyAxisAngle(THREE.Object3D.DEFAULT_UP, -yaw);
    const length = Math.hypot(localMove.x, localMove.z) || 1;
    return {
      speed,
      aiming,
      moveDir: { x: localMove.x / length, z: localMove.z / length },
      airborne: airTime > 0,
      jumpTime: airTime,
      landing: landingLeft > 0,
      aimYaw: 0,
      aimPitch,
      firing: fireLeft > 0,
      shotId,
      weapon,
      recoilT: recoilLeft / RECOIL_SECONDS,
    };
  }

  function move(dt, cameraAzimuth, aiming = false, aimPitch = 0) {
    const { x, z } = input.axis();
    const speed = PLAYER[input.gait()];

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
    recoilLeft = Math.max(0, recoilLeft - dt);
    fireLeft = Math.max(0, fireLeft - dt);

    const movement = controller.computedMovement();
    const current = body.translation();
    body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    const planarSpeed = dt > 0 ? Math.hypot(movement.x, movement.z) / dt : 0;
    character.update(dt, poseFor(dt, planarSpeed, aiming, aimPitch));

    if (facingOverride !== null) {
      turnToward(facingOverride, dt);
    } else if (moveDirection.lengthSq() > 0) {
      turnToward(Math.atan2(moveDirection.x, moveDirection.z), dt);
    }
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
    character.update(dt, poseFor(dt, 0, false, 0));
  }

  function teleport(x, z) {
    const y = terrain.heightAt(x, z) + BODY_CENTER_Y + 0.5;
    body.setNextKinematicTranslation({ x, y, z });
    verticalVelocity = 0;
  }

  return {
    mesh,
    move,
    sync,
    idle,
    teleport,
    setFacing: (value) => {
      facingOverride = value;
    },
    setWeapon: (next) => {
      weapon = next;
    },
    kick: () => {
      recoilLeft = RECOIL_SECONDS;
      fireLeft = FIRE_SECONDS;
      shotId += 1;
    },
    position: () => body.translation(),
  };
}
