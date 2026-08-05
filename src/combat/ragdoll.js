import * as THREE from 'three';
import { createSkinnedRagdolls } from './skinned-ragdoll.js';

const MIN_HALF_EXTENT = 0.03;
const BODY_DENSITY = 150;
const LINEAR_DAMPING = 0.35;
const ANGULAR_DAMPING = 0.9;
const FRICTION = 0.8;
const IMPULSE_PER_MASS = 6;
const UPWARD_KICK = 0.35;
const MAX_CORPSES = 20;

function collectSegments(root) {
  const rootSegment = { node: root, meshes: [], parent: null };
  const segments = [rootSegment];

  function walk(node, segment) {
    for (const child of node.children) {
      if (child.isMesh) {
        segment.meshes.push(child);
      } else if (child.isSprite) {
        continue;
      } else if (child.children.length) {
        const startsSegment = child.children.some((grandchild) => grandchild.isMesh);
        if (startsSegment) {
          const next = { node: child, meshes: [], parent: segment };
          segments.push(next);
          walk(child, next);
        } else {
          walk(child, segment);
        }
      }
    }
  }

  walk(root, rootSegment);
  return segments.filter((segment) => segment.meshes.length);
}

function segmentLocalBounds(segment) {
  const inverse = new THREE.Matrix4().copy(segment.node.matrixWorld).invert();
  const bounds = new THREE.Box3();
  const corner = new THREE.Vector3();
  for (const mesh of segment.meshes) {
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const { min, max } = geometry.boundingBox;
    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? max.x : min.x,
        i & 2 ? max.y : min.y,
        i & 4 ? max.z : min.z,
      );
      corner.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      bounds.expandByPoint(corner);
    }
  }
  return bounds;
}

function toBodyLocal(worldPoint, bodyPosition, bodyQuaternion) {
  return worldPoint
    .clone()
    .sub(bodyPosition)
    .applyQuaternion(bodyQuaternion.clone().invert());
}

function createSegmentedRagdolls({ RAPIER, physicsWorld, scene }) {
  const corpses = [];

  function spawn(characterRoot, { impulse }) {
    characterRoot.updateWorldMatrix(true, true);
    const segments = collectSegments(characterRoot);
    const parts = [];

    for (const segment of segments) {
      const bounds = segmentLocalBounds(segment);
      const center = bounds.getCenter(new THREE.Vector3());
      const half = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      half.x = Math.max(half.x, MIN_HALF_EXTENT);
      half.y = Math.max(half.y, MIN_HALF_EXTENT);
      half.z = Math.max(half.z, MIN_HALF_EXTENT);

      const position = center.clone().applyMatrix4(segment.node.matrixWorld);
      const quaternion = segment.node.getWorldQuaternion(new THREE.Quaternion());
      const anchor = segment.node.getWorldPosition(new THREE.Vector3());

      const body = physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(position.x, position.y, position.z)
          .setRotation(quaternion)
          .setLinearDamping(LINEAR_DAMPING)
          .setAngularDamping(ANGULAR_DAMPING),
      );
      physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
          .setDensity(BODY_DENSITY)
          .setFriction(FRICTION),
        body,
      );
      segment.part = { body, position, quaternion, anchor, meshes: segment.meshes };
      parts.push(segment.part);
    }

    for (const segment of segments) {
      const parentPart = segment.parent?.part;
      if (!parentPart) continue;
      const { part } = segment;
      const joint = RAPIER.JointData.spherical(
        toBodyLocal(part.anchor, parentPart.position, parentPart.quaternion),
        toBodyLocal(part.anchor, part.position, part.quaternion),
      );
      physicsWorld.createImpulseJoint(joint, parentPart.body, part.body, true);
    }

    for (const part of parts) {
      part.group = new THREE.Group();
      part.group.position.copy(part.position);
      part.group.quaternion.copy(part.quaternion);
      scene.add(part.group);
      for (const mesh of part.meshes) part.group.attach(mesh);
    }

    const heaviest = parts.reduce((a, b) => (b.body.mass() > a.body.mass() ? b : a));
    const kick = new THREE.Vector3(impulse.x, impulse.y + UPWARD_KICK, impulse.z)
      .normalize()
      .multiplyScalar(heaviest.body.mass() * IMPULSE_PER_MASS);
    heaviest.body.applyImpulse(kick, true);

    scene.remove(characterRoot);
    corpses.push({ parts });
    if (corpses.length > MAX_CORPSES) removeCorpse(corpses.shift());
  }

  function removeCorpse(corpse) {
    for (const part of corpse.parts) {
      physicsWorld.removeRigidBody(part.body);
      scene.remove(part.group);
    }
  }

  function update() {
    for (const corpse of corpses) {
      for (const part of corpse.parts) {
        part.group.position.copy(part.body.translation());
        part.group.quaternion.copy(part.body.rotation());
      }
    }
  }

  return { spawn, update };
}

function hasSkinnedMesh(root) {
  let found = false;
  root.traverse((child) => {
    found = found || child.isSkinnedMesh;
  });
  return found;
}

export function createRagdolls(context) {
  const segmented = createSegmentedRagdolls(context);
  const skinned = createSkinnedRagdolls(context);

  function spawn(characterRoot, hit) {
    if (hasSkinnedMesh(characterRoot) && skinned.spawn(characterRoot, hit)) return;
    segmented.spawn(characterRoot, hit);
  }

  function update() {
    segmented.update();
    skinned.update();
  }

  return { spawn, update };
}
