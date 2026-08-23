/**
 * Сцена и свет промо-кадра UNDERSTAV.
 *
 * Тут только холст, воздух и источники: геометрию зала ставит вызывающий, поэтому свет
 * знает о нефе ровно то, что записано в координатном соглашении.
 */

import * as THREE from 'three';
import { BEAT, PALETTE } from './palette.js';
import { EMBER_RING, KEY_LIGHT } from './nave.js';

const TAU = Math.PI * 2;
const HALF = 0.5;
const MAX_PIXEL_RATIO = 1.5;
const EXPOSURE = 1.15;

const CAMERA = { fov: 42, near: 0.2, far: 160, position: [0, 6.4, 15], target: [0, 6, -3] };
const FOG_DENSITY = 0.015;

const KEY = { intensity: 3.6, breath: 0.09 };
const SHADOW = {
  // Тень идёт на весь зал: на тысяче двадцати четырёх тексель весит три сантиметра, и прутья
  // розы с рёбрами свода ложились на камень лесенкой. Второй проход теней это не добавляет,
  // карта та же, просто вчетверо подробнее.
  mapSize: 2048,
  halfWidth: 16,
  halfHeight: 20,
  near: 8,
  far: 84,
  bias: -0.0004,
  normalBias: 0.06,
};
// Полусфера светит всюду и не отбрасывает ничего: на прежней силе она поднимала каждую тень
// до лавандового серого, и в кадре не оставалось ни одного чёрного пикселя.
const HEMI = { intensity: 0.2 };
const EMBER = {
  intensity: 24,
  distance: 22,
  decay: 2,
  height: 1.5,
  breath: 0.4,
  flicker: 0.18,
  flickerSpeed: [3.1, 5.7],
  phaseStep: 2,
};
const TRIP = {
  intensity: 60,
  distance: 52,
  angle: 0.4,
  penumbra: 0.85,
  decay: 1.5,
  position: [8.5, 18.5, 7],
  target: [-1.5, 3.5, -5],
  sweep: 2.6,
  sweepSpeed: 0.11,
  breath: 0.25,
};

function createKeyLight() {
  const light = new THREE.DirectionalLight(PALETTE.moon, KEY.intensity);
  light.position.set(...KEY_LIGHT.from);
  light.target.position.set(...KEY_LIGHT.to);
  light.castShadow = true;
  light.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  light.shadow.camera.left = -SHADOW.halfWidth;
  light.shadow.camera.right = SHADOW.halfWidth;
  light.shadow.camera.top = SHADOW.halfHeight;
  light.shadow.camera.bottom = -SHADOW.halfHeight;
  light.shadow.camera.near = SHADOW.near;
  light.shadow.camera.far = SHADOW.far;
  light.shadow.bias = SHADOW.bias;
  light.shadow.normalBias = SHADOW.normalBias;
  return light;
}

function createEmberLights() {
  return EMBER_RING.anchors.map((angle) => {
    const light = new THREE.PointLight(
      PALETTE.emberHalo,
      EMBER.intensity,
      EMBER.distance,
      EMBER.decay,
    );
    light.position.set(
      Math.cos(angle) * EMBER_RING.radius,
      EMBER.height,
      Math.sin(angle) * EMBER_RING.radius,
    );
    return light;
  });
}

function createTripLight() {
  const light = new THREE.SpotLight(
    PALETTE.trip,
    TRIP.intensity,
    TRIP.distance,
    TRIP.angle,
    TRIP.penumbra,
    TRIP.decay,
  );
  light.position.set(...TRIP.position);
  light.target.position.set(...TRIP.target);
  return light;
}

export function createStage({ mount }) {
  // Сглаживание в буфере экрана выключено: кадр собирает постобработка в свои мишени,
  // и до экрана доезжает результат последнего прохода, а не этот буфер.
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.void);
  scene.fog = new THREE.FogExp2(PALETTE.iron, FOG_DENSITY);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(...CAMERA.position);
  camera.lookAt(...CAMERA.target);

  const keyLight = createKeyLight();
  scene.add(keyLight, keyLight.target);

  const emberLights = createEmberLights();
  for (const light of emberLights) scene.add(light);

  const hemiLight = new THREE.HemisphereLight(PALETTE.moon, PALETTE.void, HEMI.intensity);
  scene.add(hemiLight);

  const tripLight = createTripLight();
  scene.add(tripLight, tripLight.target);

  function resize(width, height) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /** Дыхание в темп: свет наливается и отпускает, а не мигает стробоскопом. */
  function update(dt, elapsed) {
    const breath = HALF + HALF * Math.sin((elapsed / BEAT.seconds) * TAU);
    keyLight.intensity = KEY.intensity * (1 - KEY.breath * breath);
    for (let index = 0; index < emberLights.length; index += 1) {
      const flicker = Math.sin(elapsed * EMBER.flickerSpeed[0] + index)
        * Math.sin(elapsed * EMBER.flickerSpeed[1] + index * EMBER.phaseStep);
      emberLights[index].intensity = EMBER.intensity
        * (1 + EMBER.breath * breath + EMBER.flicker * flicker);
    }
    tripLight.intensity = TRIP.intensity * (1 - TRIP.breath * (1 - breath));
    tripLight.target.position.x = TRIP.target[0] + Math.sin(elapsed * TRIP.sweepSpeed) * TRIP.sweep;
  }

  resize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);

  return { renderer, scene, camera, resize, update };
}
