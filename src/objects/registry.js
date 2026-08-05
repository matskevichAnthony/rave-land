import * as THREE from 'three';
import { OBJECT_BUILDERS } from './library.js';
import { loadModel } from './gltf.js';
import { mulberry32 } from '../terrain/heightfield.js';
import { MAX_LAMP_LIGHTS } from '../config.js';

export function createRegistry({ RAPIER, physicsWorld, scene, terrain }) {
  const items = new Map();
  const pulseMaterials = [];
  let lampLightCount = 0;
  let buildSeedCounter = 1;

  function collectPulseMaterials(object) {
    object.traverse((child) => {
      if (child.isMesh && child.material.userData.pulse) {
        pulseMaterials.push(child.material);
      }
    });
  }

  function enableShadows(object) {
    object.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
  }

  function createBody(entry, object) {
    object.updateWorldMatrix(true, true);
    const builderCollider = items.get(entry.id)?.colliderSpec ?? null;

    if (builderCollider) {
      const body = physicsWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(object.position.x, object.position.y, object.position.z)
          .setRotation(object.quaternion),
      );
      const [hx, hy, hz] = builderCollider.halfExtents;
      const [ox, oy, oz] = builderCollider.offset;
      physicsWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(hx * object.scale.x, hy * object.scale.y, hz * object.scale.z)
          .setTranslation(ox * object.scale.x, oy * object.scale.y, oz * object.scale.z),
        body,
      );
      return body;
    }

    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return null;
    const center = box.getCenter(new THREE.Vector3());
    const halfSize = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const body = physicsWorld.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z),
    );
    physicsWorld.createCollider(
      RAPIER.ColliderDesc.cuboid(halfSize.x, halfSize.y, halfSize.z),
      body,
    );
    return body;
  }

  async function buildObject(entry) {
    if (entry.type === 'model') {
      const object = await loadModel(entry.src);
      return { object, collider: null };
    }
    const builder = OBJECT_BUILDERS[entry.type];
    if (!builder) throw new Error(`Неизвестный тип объекта: ${entry.type}`);
    const random = mulberry32(buildSeedCounter);
    buildSeedCounter += 1;
    const allowLight = entry.type !== 'lamp' || lampLightCount < MAX_LAMP_LIGHTS;
    if (entry.type === 'lamp' && allowLight) lampLightCount += 1;
    return builder(random, { allowLight });
  }

  async function add(entry) {
    const { object, collider } = await buildObject(entry);
    const [x, y, z] = entry.position;
    object.position.set(x, y ?? terrain.heightAt(x, z), z);
    object.rotation.set(...(entry.rotation ?? [0, 0, 0]));
    object.scale.set(...(entry.scale ?? [1, 1, 1]));
    object.userData.entryId = entry.id;
    enableShadows(object);
    collectPulseMaterials(object);
    scene.add(object);

    const item = { entry, object, colliderSpec: collider, body: null };
    items.set(entry.id, item);
    item.body = createBody(entry, object);
    return item;
  }

  function remove(id) {
    const item = items.get(id);
    if (!item) return;
    scene.remove(item.object);
    if (item.body) physicsWorld.removeRigidBody(item.body);
    items.delete(id);
  }

  function refreshBody(id) {
    const item = items.get(id);
    if (!item) return;
    if (item.body) physicsWorld.removeRigidBody(item.body);
    item.body = createBody(item.entry, item.object);
  }

  function snapToGround(id) {
    const item = items.get(id);
    if (!item) return;
    const { x, z } = item.object.position;
    item.object.position.y = terrain.heightAt(x, z);
    refreshBody(id);
  }

  function resnapAll() {
    for (const id of items.keys()) snapToGround(id);
  }

  function updatePulse(time) {
    for (const mat of pulseMaterials) {
      const { baseIntensity, amplitude, speed, phase } = mat.userData.pulse;
      mat.emissiveIntensity = baseIntensity + Math.sin(time * speed + phase) * amplitude;
    }
  }

  function serializeEntries() {
    return [...items.values()].map(({ entry, object }) => ({
      ...entry,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray(),
    }));
  }

  return {
    add,
    remove,
    refreshBody,
    snapToGround,
    resnapAll,
    updatePulse,
    serializeEntries,
    get objects() {
      return [...items.values()].map((item) => item.object);
    },
    itemByObject(object) {
      let node = object;
      while (node) {
        if (node.userData.entryId) return items.get(node.userData.entryId);
        node = node.parent;
      }
      return null;
    },
  };
}
