/**
 * Холст, воздух и свет сцены AKHET.
 *
 * Свет вывернут наизнанку относительно соседней сцены: не один луч в темноте, а отвесный
 * полдень. Источник в кадре главный один, солнце в пятидесяти шести градусах над
 * горизонтом, и его тени короткие и жёсткие. Небо подмешивает синеву в эти тени и держит
 * их холодными, но не поднимает: тьма в кадре осталась ровно там, куда не достаёт солнце.
 *
 * Третий источник это ядро вихря. Он живёт только на пике бури и светит бирюзой, потому
 * что единственное цветное пятно сцены обязано быть в её событии, а не в декорации.
 */

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { HALL, VIEW, VORTEX, stormPhase, surgeAt } from './hall.js';

const MAX_PIXEL_RATIO = 1.5;
const EXPOSURE = 1.02;

const CAMERA = { fov: 42, near: 0.4, far: 1600 };
/**
 * Плотность марева подобрана по дальним пирамидам.
 *
 * На сотне метров, где стоят ворота, туман съедает пять процентов и работает воздухом.
 * На трёхстах, где стоят пирамиды, он съедает треть: они остаются силуэтом, а не пятном в
 * цвет неба. Прежние три с половиной тысячных съедали на той же дистанции три четверти, и
 * кадр выходил молочным: дальний план сливался с горизонтом, а тени тонули в дымке.
 */
const FOG_DENSITY = 0.0021;

const SUN = { intensity: 3.6, offset: [-60, 112, 46] };
const SHADOW = {
  mapSize: 2048,
  half: 64,
  near: 40,
  far: 300,
  bias: -0.0006,
  normalBias: 0.08,
};
const SITE_CENTER = new THREE.Vector3(0, 0, -20);
/**
 * Небо подсвечивает тени, но не заливает их.
 *
 * Полуторная доля от солнца поднимала теневую сторону камня почти до освещённой, и полдень
 * читался пасмурным днём. Треть оставляет тень плотной и холодной, а жёсткая граница
 * между ней и светом и есть то, чем этот кадр держится.
 */
const DOME = { sky: 0.38 };
const CORE = { intensity: 34, distance: 28, decay: 2, height: 10 };

function createSun() {
  const light = new THREE.DirectionalLight(PALETTE.sun, SUN.intensity);
  light.castShadow = true;
  light.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  light.shadow.camera.left = -SHADOW.half;
  light.shadow.camera.right = SHADOW.half;
  light.shadow.camera.top = SHADOW.half;
  light.shadow.camera.bottom = -SHADOW.half;
  light.shadow.camera.near = SHADOW.near;
  light.shadow.camera.far = SHADOW.far;
  light.shadow.bias = SHADOW.bias;
  light.shadow.normalBias = SHADOW.normalBias;
  light.position.copy(SITE_CENTER).add(new THREE.Vector3(...SUN.offset));
  light.target.position.copy(SITE_CENTER);
  return light;
}

export function createStage({ mount }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.shadowMap.enabled = true;
  // Тень полудня обязана быть резкой: мягкая кромка превращает её в грязное пятно.
  renderer.shadowMap.type = THREE.PCFShadowMap;
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PALETTE.haze);
  scene.fog = new THREE.FogExp2(PALETTE.haze, FOG_DENSITY);

  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
  camera.position.set(...VIEW.poster.position);
  camera.lookAt(...VIEW.poster.target);

  const sun = createSun();
  scene.add(sun, sun.target);

  const dome = new THREE.HemisphereLight(PALETTE.zenith, PALETTE.sandDeep, DOME.sky);
  scene.add(dome);

  const core = new THREE.PointLight(PALETTE.faience, 0, CORE.distance, CORE.decay);
  core.position.set(VORTEX.x, HALL.floorY + CORE.height, VORTEX.z);
  scene.add(core);

  function resize(width, height) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  /** Солнце стоит: день в этой сцене не идёт, идёт буря. */
  function update(dt, elapsed) {
    core.intensity = CORE.intensity * surgeAt(stormPhase(elapsed));
  }

  resize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);

  return { renderer, scene, camera, resize, update };
}
