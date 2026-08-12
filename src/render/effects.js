import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createGradePass } from './grade.js';
import { BLOOM } from '../config.js';

// Свечение это пять уровней размытия, и каждый стоит ровно по площади своего входа. Половина
// стороны означает четверть работы, а на глаз ничего не меняет: размытие само по себе мягкое.
const BLOOM_SCALE = 0.5;

const bloomResolution = () => new THREE.Vector2(
  window.innerWidth * BLOOM_SCALE,
  window.innerHeight * BLOOM_SCALE,
);

export function createComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    bloomResolution(),
    BLOOM.strength,
    BLOOM.radius,
    BLOOM.threshold,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const gradePass = createGradePass();
  composer.addPass(gradePass);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    // Композитор раздаёт свой размер всем проходам подряд, поэтому уменьшенное свечение
    // приходится возвращать после него, иначе после первого же ресайза оно станет полным.
    const { x, y } = bloomResolution();
    bloom.setSize(x, y);
  });

  return {
    render(time) {
      gradePass.uniforms.uTime.value = time % 1000;
      composer.render();
    },
  };
}
