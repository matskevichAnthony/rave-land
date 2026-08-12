import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { createStage } from './render/stage.js';
import { createComposer } from './render/effects.js';
import { createTerrain } from './terrain/terrain.js';
import { createRegistry } from './objects/registry.js';
import { registerBlobUrl } from './objects/gltf.js';
import { createPlayer } from './player/player.js';
import { createFollowCamera } from './player/follow-camera.js';
import { createEditor } from './editor/editor.js';
import { createNpcSystem } from './npc/system.js';
import { createRagdolls } from './combat/ragdoll.js';
import { createCombat } from './combat/weapon.js';
import { createBattleAudio } from './audio/battle.js';
import { loadWorld } from './world/manifest.js';
import { toast } from './ui/toast.js';
import { TERRAIN_DEFAULTS } from './config.js';

const MAX_FRAME_DT = 1 / 20;

async function boot() {
  await RAPIER.init();
  const physicsWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  const worldState = await loadWorld();
  const stage = createStage();
  const { renderer, scene, camera } = stage;
  stage.setTimeOfDay(worldState.timeOfDay ?? 'night');
  const composer = createComposer(renderer, scene, camera);

  const terrain = createTerrain({
    RAPIER,
    physicsWorld,
    scene,
    params: { ...TERRAIN_DEFAULTS, ...worldState.terrain },
  });

  const registry = createRegistry({ RAPIER, physicsWorld, scene, terrain });
  await Promise.allSettled((worldState.objects ?? []).map((entry) => registry.add(entry)));

  const npcSystem = createNpcSystem({ scene, camera, terrain, renderer });
  await Promise.allSettled((worldState.npcs ?? []).map((entry) => npcSystem.add(entry)));

  const player = await createPlayer({ RAPIER, physicsWorld, terrain, scene });
  const followCam = createFollowCamera(camera, renderer.domElement, terrain);
  followCam.snapTo(player.position());
  const editor = createEditor({
    scene,
    camera,
    renderer,
    followCam,
    registry,
    terrain,
    player,
    npcSystem,
    stage,
  });

  const ragdolls = createRagdolls({ RAPIER, physicsWorld, scene });
  const battleAudio = createBattleAudio({ camera });
  const combat = createCombat({
    scene,
    camera,
    renderer,
    npcSystem,
    ragdolls,
    player,
    audio: battleAudio,
    isEditing: () => editor.editing,
  });

  setupModelDrop(editor);

  window.raveland = {
    scene,
    followCam,
    playerMesh: player.mesh,
    playerPosition: () => player.position(),
    heightAt: (x, z) => terrain.heightAt(x, z),
    world: () => ({
      terrain: terrain.params,
      objects: registry.serializeEntries(),
      npcs: npcSystem.serialize(),
    }),
    addObject: (entry) => registry.add({ id: crypto.randomUUID(), ...entry }),
    removeObject: (id) => registry.remove(id),
    addNpc: (entry) => npcSystem.add({ id: crypto.randomUUID(), ...entry }),
    removeNpc: (id) => npcSystem.remove(id),
    npcPositions: () =>
      npcSystem.objects.map((object) => ({
        id: object.userData.npcId,
        x: object.position.x,
        y: object.position.y,
        z: object.position.z,
      })),
    screenPoint: (x, y, z) => {
      const projected = new THREE.Vector3(x, y, z).project(camera);
      return {
        x: ((projected.x + 1) / 2) * window.innerWidth,
        y: ((1 - projected.y) / 2) * window.innerHeight,
        visible: projected.z < 1,
      };
    },
  };

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), MAX_FRAME_DT);

    const aiming = combat.armed && !editor.editing;
    followCam.setAiming(aiming);
    player.setFacing(aiming ? followCam.azimuth() + Math.PI : null);
    if (editor.editing) {
      player.idle(dt);
    } else {
      player.move(dt, followCam.azimuth(), aiming, followCam.aimPitch());
    }
    physicsWorld.timestep = dt;
    physicsWorld.step();
    player.sync();
    stage.focusShadow(player.mesh.position);
    ragdolls.update();
    combat.update(dt);

    if (editor.editing) {
      followCam.update();
    } else {
      followCam.follow(player.mesh.position);
    }
    npcSystem.update(dt);
    registry.updatePulse(clock.elapsedTime);
    composer.render(clock.elapsedTime);
  });
}

function setupModelDrop(editor) {
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    const file = [...event.dataTransfer.files].find((f) => /\.(glb|gltf)$/i.test(f.name));
    if (!file) return;

    const src = `assets/models/${file.name}`;
    registerBlobUrl(src, URL.createObjectURL(file));
    await editor.spawnModelEntry(src);
    toast(`Модель добавлена. Чтобы она пережила перезагрузку, положи файл в public/${src}`);
  });
}

boot().catch((error) => {
  console.error(error);
  toast(`Не удалось запустить мир: ${error.message}`, 10000);
});
