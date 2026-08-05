import * as THREE from 'three';
import { clone as cloneWithSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { loadModelData } from '../objects/gltf.js';

const TARGET_HEIGHT = 1.75;
const WALK_THRESHOLD = 0.1;
const RUN_THRESHOLD = 3;
const FADE_SECONDS = 0.25;

function pickClip(animations, patterns) {
  return animations.find((clip) => patterns.some((pattern) => pattern.test(clip.name)));
}

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

  const mixer = new THREE.AnimationMixer(model);
  const idleClip = pickClip(animations, [/idle|stand|breath/i]) ?? animations[0];
  const walkClip = pickClip(animations, [/walk/i]) ?? idleClip;
  const runClip = pickClip(animations, [/run|sprint|jog/i]) ?? walkClip;
  const aimClip = pickClip(animations, [/aim/i]);
  const actions = new Map();
  let currentAction = null;

  function actionFor(clip) {
    if (!clip) return null;
    if (!actions.has(clip)) actions.set(clip, mixer.clipAction(clip));
    return actions.get(clip);
  }

  function locomotionClip(speed) {
    return speed > RUN_THRESHOLD ? runClip : speed > WALK_THRESHOLD ? walkClip : idleClip;
  }

  function update(dt, { speed, aiming = false }) {
    const clip = aiming && aimClip ? aimClip : locomotionClip(speed);
    const action = actionFor(clip);
    if (action && action !== currentAction) {
      action.reset().fadeIn(FADE_SECONDS).play();
      currentAction?.fadeOut(FADE_SECONDS);
      currentAction = action;
    }
    mixer.update(dt);
  }

  function stopAnimation() {
    mixer.stopAllAction();
  }

  return { object: root, update, stopAnimation };
}
