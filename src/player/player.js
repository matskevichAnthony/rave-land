import * as THREE from 'three';
import { input } from './input.js';
import { buildCharacter } from '../characters/builder.js';
import { buildGltfCharacter } from '../npc/gltf-character.js';
import { PLAYER } from '../config.js';

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HALF_HEIGHT = 0.55;
const BODY_CENTER_Y = CAPSULE_HALF_HEIGHT + CAPSULE_RADIUS;

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
  const moveDirection = new THREE.Vector3();

  function turnToward(targetYaw, dt) {
    let diff = targetYaw - yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    yaw += diff * Math.min(1, dt * 12);
  }

  function move(dt, cameraAzimuth, aiming = false) {
    const { x, z } = input.axis();
    const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    const speed = running ? PLAYER.runSpeed : PLAYER.walkSpeed;

    const forwardX = -Math.sin(cameraAzimuth);
    const forwardZ = -Math.cos(cameraAzimuth);
    moveDirection
      .set(forwardX * z + -forwardZ * x, 0, forwardZ * z + forwardX * x)
      .normalize()
      .multiplyScalar(x || z ? speed * dt : 0);

    if (controller.computedGrounded() && input.isDown('Space')) {
      verticalVelocity = PLAYER.jumpSpeed;
    }
    verticalVelocity += PLAYER.gravity * dt;

    controller.computeColliderMovement(collider, {
      x: moveDirection.x,
      y: verticalVelocity * dt,
      z: moveDirection.z,
    });
    if (controller.computedGrounded() && verticalVelocity < 0) verticalVelocity = 0;

    const movement = controller.computedMovement();
    const current = body.translation();
    body.setNextKinematicTranslation({
      x: current.x + movement.x,
      y: current.y + movement.y,
      z: current.z + movement.z,
    });
    const planarSpeed = dt > 0 ? Math.hypot(movement.x, movement.z) / dt : 0;
    character.update(dt, { speed: planarSpeed, aiming });

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
    character.update(dt, { speed: 0, aiming: false });
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
    position: () => body.translation(),
  };
}
