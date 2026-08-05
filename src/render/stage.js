import * as THREE from 'three';
import { CAMERA } from '../config.js';

const STAR_COUNT = 800;
const STAR_RADIUS = 420;

const TIME_PRESETS = {
  night: {
    sky: '#14102b',
    fogNear: 60,
    fogFar: 320,
    hemiSky: '#7a68b8',
    hemiGround: '#2a2038',
    hemiIntensity: 1.2,
    sun: '#aab4ff',
    sunIntensity: 0.9,
    sunPosition: [60, 90, -40],
    stars: true,
  },
  morning: {
    sky: '#d08a64',
    fogNear: 80,
    fogFar: 380,
    hemiSky: '#ffd2b0',
    hemiGround: '#6b4a44',
    hemiIntensity: 1.0,
    sun: '#ffb37a',
    sunIntensity: 1.7,
    sunPosition: [-70, 35, 20],
    stars: false,
  },
  day: {
    sky: '#87b5d9',
    fogNear: 100,
    fogFar: 450,
    hemiSky: '#cfe6ff',
    hemiGround: '#8a7f6a',
    hemiIntensity: 1.1,
    sun: '#fff3d6',
    sunIntensity: 2.2,
    sunPosition: [40, 110, 30],
    stars: false,
  },
};

function createStars() {
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i += 1) {
    const direction = new THREE.Vector3()
      .randomDirection()
      .setY(Math.abs(Math.random()) * 0.9 + 0.05)
      .normalize();
    direction.multiplyScalar(STAR_RADIUS);
    positions.set([direction.x, direction.y, direction.z], i * 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: '#cfd6ff',
    size: 1.6,
    sizeAttenuation: true,
    fog: false,
  });
  return new THREE.Points(geometry, material);
}

export function createStage() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.querySelector('#app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color();
  scene.fog = new THREE.Fog(new THREE.Color(), 60, 320);

  const camera = new THREE.PerspectiveCamera(
    CAMERA.fov,
    window.innerWidth / window.innerHeight,
    CAMERA.near,
    CAMERA.far,
  );
  camera.position.set(0, 8, 36);

  const hemiLight = new THREE.HemisphereLight();
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight();
  sunLight.castShadow = true;
  sunLight.shadow.camera.left = -90;
  sunLight.shadow.camera.right = 90;
  sunLight.shadow.camera.top = 90;
  sunLight.shadow.camera.bottom = -90;
  sunLight.shadow.mapSize.set(2048, 2048);
  scene.add(sunLight);

  const stars = createStars();
  scene.add(stars);

  let timeOfDay = 'night';

  function setTimeOfDay(name) {
    const preset = TIME_PRESETS[name] ?? TIME_PRESETS.night;
    timeOfDay = TIME_PRESETS[name] ? name : 'night';
    scene.background.set(preset.sky);
    scene.fog.color.set(preset.sky);
    scene.fog.near = preset.fogNear;
    scene.fog.far = preset.fogFar;
    hemiLight.color.set(preset.hemiSky);
    hemiLight.groundColor.set(preset.hemiGround);
    hemiLight.intensity = preset.hemiIntensity;
    sunLight.color.set(preset.sun);
    sunLight.intensity = preset.sunIntensity;
    sunLight.position.set(...preset.sunPosition);
    stars.visible = preset.stars;
  }

  setTimeOfDay('night');

  return {
    renderer,
    scene,
    camera,
    setTimeOfDay,
    get timeOfDay() {
      return timeOfDay;
    },
  };
}
