import * as THREE from 'three';
import { CAMERA } from '../config.js';

const STAR_COUNT = 800;
const STAR_RADIUS = 420;
// На экране 4K множитель 2 означает вчетверо больше пикселей на каждый проход композитора.
// Полтора это предел, за которым разница уже не видна, а кадр дорожает линейно.
// Кадр упирается в пиксели, а не в логику: замер показал, что тот же бой в меньшем
// разрешении роняет долю просадок с 9.9% до 1.7%. На экране с плотностью 2 потолок 1.25
// это на треть меньше пикселей, чем 1.5, и это самая дешёвая покупка кадра.
const MAX_PIXEL_RATIO = 1.25;
// Тень раньше накрывала весь мир картой 2048: 8.8 см на тексель и полный проход геометрии
// по площади 180 на 180. Коробка вчетверо меньше едет за игроком, поэтому у него под ногами
// тень стала вдвое чётче, а платить за неё приходится вчетверо меньше.
// Тень видит квадрат вокруг игрока, и в неё же упирается второй обход сцены за кадр.
// Меньше квадрат, меньше объектов в проходе теней и вдвое мельче тексель на метр.
const SHADOW_EXTENT = 32;
const SHADOW_MAP_SIZE = 1024;
const SHADOW_DISTANCE = 90;
const SHADOW_TEXEL = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;

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
  // Сглаживание в буфере экрана выключено осознанно: кадр собирает EffectComposer в свои
  // мишени, и до экрана доезжает результат последнего прохода, а не этот буфер. MSAA тут
  // оплачивался бы памятью и пропускной способностью, не появляясь в картинке.
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
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
  sunLight.shadow.camera.left = -SHADOW_EXTENT;
  sunLight.shadow.camera.right = SHADOW_EXTENT;
  sunLight.shadow.camera.top = SHADOW_EXTENT;
  sunLight.shadow.camera.bottom = -SHADOW_EXTENT;
  sunLight.shadow.camera.far = SHADOW_DISTANCE * 2;
  sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  scene.add(sunLight);
  scene.add(sunLight.target);

  const stars = createStars();
  scene.add(stars);

  let timeOfDay = 'night';
  const sunDirection = new THREE.Vector3();

  /**
   * Держать коробку теней на игроке.
   *
   * Центр защёлкивается по сетке текселей карты: без этого коробка едет плавно, край тени
   * попадает то в один тексель, то в соседний, и тень «кипит» на каждом шаге персонажа.
   */
  function focusShadow(point) {
    const x = Math.round(point.x / SHADOW_TEXEL) * SHADOW_TEXEL;
    const z = Math.round(point.z / SHADOW_TEXEL) * SHADOW_TEXEL;
    sunLight.target.position.set(x, point.y, z);
    sunLight.position.copy(sunLight.target.position).addScaledVector(sunDirection, SHADOW_DISTANCE);
  }

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
    sunDirection.set(...preset.sunPosition).normalize();
    focusShadow(sunLight.target.position);
    stars.visible = preset.stars;
  }

  setTimeOfDay('night');

  return {
    renderer,
    scene,
    camera,
    setTimeOfDay,
    focusShadow,
    get timeOfDay() {
      return timeOfDay;
    },
  };
}
