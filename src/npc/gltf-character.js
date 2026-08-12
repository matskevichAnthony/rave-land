import * as THREE from 'three';
import { clone as cloneWithSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { loadModelData } from '../objects/gltf.js';
import { clipCoverage, createCharacterAnimator } from '../anim/character-animator.js';
import { detectProfile } from '../anim/skeleton-profile.js';

const TARGET_HEIGHT = 1.75;

const PUPPET_STEP_FREQUENCY = 9;
const PUPPET_SWAY = 0.07;
const PUPPET_HOP = 0.05;
const PUPPET_LEAN = 0.12;

function createPuppetAnimator(model, baseY) {
  let phase = 0;
  let energy = 0;
  return (dt, { speed }) => {
    const target = Math.min(speed / 1.4, 2);
    energy += (target - energy) * Math.min(1, dt * 8);
    phase += dt * PUPPET_STEP_FREQUENCY * Math.max(energy, 0.2);
    model.rotation.z = Math.sin(phase) * PUPPET_SWAY * energy;
    model.rotation.x = PUPPET_LEAN * Math.min(energy, 1) * (speed > 3 ? 1.6 : 1);
    model.position.y = baseY + Math.abs(Math.sin(phase)) * PUPPET_HOP * energy;
  };
}

export async function buildGltfCharacter(src) {
  const { scene, animations } = await loadModelData(src);
  const model = cloneWithSkeleton(scene);

  const box = new THREE.Box3().setFromObject(model);
  const height = box.getSize(new THREE.Vector3()).y;
  if (height > 0) {
    const scale = TARGET_HEIGHT / height;
    model.scale.setScalar(scale);
    model.position.y = -box.min.y * scale;
  }
  const root = new THREE.Group();
  root.add(model);

  if (!animations.length) {
    return { object: root, update: createPuppetAnimator(model, model.position.y) };
  }

  const profile = detectProfile(model);
  const animator = createCharacterAnimator({ model, animations, profile });
  const coverage = clipCoverage(animations, profile);
  console.log(`[anim] ${src} профиль ${profile.id}`
    + `, полные прицельные клипы: ${coverage.directionalAim ? 'да' : 'нет'}`
    + `, маски: ${coverage.trackSplit
      ? `${coverage.trackSplit.lower}+${coverage.trackSplit.upper}=${coverage.trackSplit.total}`
      : 'недоступны'}`
    + `, ролей не найдено: ${coverage.missing.join(', ') || 'ни одной'}`);

  return {
    object: root,
    model,
    profile,
    update: animator.update,
    stopAnimation: () => animator.mixer.stopAllAction(),
  };
}
