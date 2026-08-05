import * as THREE from 'three';
import { buildCharacter } from '../characters/builder.js';
import { buildGltfCharacter } from './gltf-character.js';
import { createWanderer } from './wander.js';
import { createNameLabel } from './label.js';
import { createInfoCard } from './info-card.js';

const WORLD_RADIUS_FACTOR = 0.45;

export function createNpcSystem({ scene, camera, terrain, renderer }) {
  const npcs = new Map();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const card = createInfoCard();
  let cardEnabled = true;

  async function add(entry) {
    const { object, update, stopAnimation } = entry.src
      ? await buildGltfCharacter(entry.src)
      : await buildCharacter({ archetype: entry.archetype, seed: entry.seed });
    const [x, y, z] = entry.position;
    object.position.set(x, y ?? terrain.heightAt(x, z), z);
    object.userData.npcId = entry.id;
    object.add(createNameLabel(entry.name));
    scene.add(object);
    npcs.set(entry.id, {
      entry,
      object,
      animate: update,
      stopAnimation,
      wanderer: createWanderer({
        seed: entry.seed,
        home: { x, z },
        worldRadius: terrain.params.size * WORLD_RADIUS_FACTOR,
      }),
    });
  }

  function remove(id) {
    const npc = npcs.get(id);
    if (!npc) return;
    scene.remove(npc.object);
    npc.object.traverse((child) => {
      if (child.isSprite) {
        child.material.map.dispose();
        child.material.dispose();
      }
    });
    npcs.delete(id);
  }

  function update(dt) {
    for (const npc of npcs.values()) {
      const { x, z, yaw, speed } = npc.wanderer.update(dt);
      npc.object.position.set(x, terrain.heightAt(x, z), z);
      npc.object.rotation.y = yaw;
      npc.animate(dt, { speed });
    }
  }

  function serialize() {
    return [...npcs.values()].map(({ entry, wanderer }) => ({
      ...entry,
      position: [wanderer.home.x, null, wanderer.home.z],
    }));
  }

  function npcAt(clientX, clientY) {
    pointer.set(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const objects = [...npcs.values()].map((npc) => npc.object);
    const hits = raycaster.intersectObjects(objects, true);
    if (!hits.length) return null;
    let node = hits[0].object;
    while (node && !node.userData.npcId) node = node.parent;
    return node ? npcs.get(node.userData.npcId) : null;
  }

  function kill(id) {
    const npc = npcs.get(id);
    if (!npc) return null;
    const sprites = [];
    npc.object.traverse((child) => {
      if (child.isSprite) sprites.push(child);
    });
    for (const sprite of sprites) {
      sprite.removeFromParent();
      sprite.material.map.dispose();
      sprite.material.dispose();
    }
    npcs.delete(id);
    card.hide();
    return npc;
  }

  function setCardEnabled(enabled) {
    cardEnabled = enabled;
    if (!enabled) card.hide();
  }

  renderer.domElement.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !cardEnabled) return;
    const locked = document.pointerLockElement === renderer.domElement;
    const npc = locked
      ? npcAt(window.innerWidth / 2, window.innerHeight / 2)
      : npcAt(event.clientX, event.clientY);
    if (npc) {
      card.show(npc.entry);
    } else {
      card.hide();
    }
  });

  return {
    add,
    remove,
    kill,
    setCardEnabled,
    update,
    serialize,
    get objects() {
      return [...npcs.values()].map((npc) => npc.object);
    },
    get count() {
      return npcs.size;
    },
  };
}
