/**
 * Сцена и свет промо-кадра UNDERSTAV.
 *
 * Тут только холст, воздух и источники: геометрию зала ставит вызывающий, поэтому свет
 * знает о нефе ровно то, что записано в координатном соглашении.
 */

import * as THREE from 'three';
import { BEAT, PALETTE } from './palette.js';
import { CORRIDOR, EMBER_RING, KEY_LIGHT, NAVE } from './nave.js';

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
// до лавандового серого, и в кадре не оставалось ни одного чёрного пикселя. Низ она красит
// железом, а не пустотой: с чёрным низом всё, что смотрит вбок и вниз, уходило в ноль, и
// колоннада читалась силуэтом без объёма.
const HEMI = { intensity: 0.3, ground: PALETTE.iron };
const EMBER = {
  intensity: 26,
  // Радиус дотягивается до колоннады и стен зала: на прежних двадцати двух свет бочек
  // кончался, не дойдя до боковых нефов, и по краям кадра стоял чёрный провал.
  distance: 30,
  decay: 2,
  height: 1.5,
  breath: 0.4,
  flicker: 0.18,
  flickerSpeed: [3.1, 5.7],
  phaseStep: 2,
};
/**
 * Зарево зала, уходящее в коридор.
 *
 * До него коридор не освещал никто: жаровни и факелы там нарисованная эмиссия, а ключ и
 * бочки стоят в зале и до прохода не дотягиваются. Стены, колонны, цепи и колючка выходили
 * в кадр чёрными силуэтами, и весь пролёт шёл по чёрной трубе.
 *
 * Источник стоит не в зале, а сразу за порогом коридора и светит от зала вдаль, то есть
 * навстречу летящей камере: так проход получает не заливку, а контровой очерк по всему, что
 * торчит в него поперёк, а кадр афиши не меняется вовсе — конус смотрит от зала, и в зал не
 * попадает ни один его пиксель.
 *
 * Спад пологий (`decay` меньше единицы) намеренно. Физический квадрат на ста метрах прохода
 * гасит свет в ноль на первой же трети, и дальше остаётся цвет тумана; глубину дальнего конца
 * тут и без того держат туман и затемнение реквизита, а от источника нужна дотяжка.
 *
 * Тени он не бросает: карта на сто метров прохода стоила бы дороже всего, что она бы там
 * нарисовала.
 */
const PORTAL = {
  // Свет из зала бьёт навстречу камере по всей дороге, и он же главный источник яркости
  // коридора. Убавлен ради выхода к афише: дорога обязана быть темнее того, к чему ведёт.
  intensity: 130,
  distance: CORRIDOR.farZ + 22,
  angle: 0.4,
  penumbra: 0.9,
  decay: 0.6,
  position: [0, 6, NAVE.frontZ + 12],
  target: [0, 2.4, CORRIDOR.farZ * 0.85],
  breath: 0.18,
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

/**
 * Ширина холста, при которой его буфер выходит чётным.
 *
 * H.264 кодирует пиксели парами, и нечётную сторону буфера не берёт ни кодировщик записи,
 * ни mp4. Плотность буфера дробная, поэтому чётность считается по нему, а не по холсту:
 * тысяча CSS-точек при полутора даёт полторы тысячи, а девятьсот девяносто восемь уже
 * тысячу четыреста девяносто семь. Дешевле отдать кадру пару точек, чем потом лечить дубль.
 */
function evenBuffer(size, ratio) {
  let css = Math.floor(size);
  while (css > 1 && Math.floor(css * ratio) % 2 !== 0) css -= 1;
  return css;
}

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

function createPortalLight() {
  const light = new THREE.SpotLight(
    PALETTE.emberHalo,
    PORTAL.intensity,
    PORTAL.distance,
    PORTAL.angle,
    PORTAL.penumbra,
    PORTAL.decay,
  );
  light.position.set(...PORTAL.position);
  light.target.position.set(...PORTAL.target);
  return light;
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

  const hemiLight = new THREE.HemisphereLight(PALETTE.moon, HEMI.ground, HEMI.intensity);
  scene.add(hemiLight);

  const portalLight = createPortalLight();
  scene.add(portalLight, portalLight.target);

  const tripLight = createTripLight();
  scene.add(tripLight, tripLight.target);

  /**
   * Размер холста в CSS-метрах и плотность его буфера.
   *
   * Экранная плотность прижата потолком ради кадров в секунду, но снимок кадрами не платит:
   * он один. Поэтому `density` умеет только поднимать её выше экранной, и снимок выходит
   * крупнее окна, в котором его нашли.
   */
  function resize(width, height, density = 0) {
    const screen = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
    const ratio = Math.max(screen, density);
    renderer.setPixelRatio(ratio);
    renderer.setSize(evenBuffer(width, ratio), evenBuffer(height, ratio));
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
    portalLight.intensity = PORTAL.intensity * (1 - PORTAL.breath * (1 - breath));
    tripLight.intensity = TRIP.intensity * (1 - TRIP.breath * (1 - breath));
    tripLight.target.position.x = TRIP.target[0] + Math.sin(elapsed * TRIP.sweepSpeed) * TRIP.sweep;
  }

  resize(mount.clientWidth || window.innerWidth, mount.clientHeight || window.innerHeight);

  return { renderer, scene, camera, resize, update };
}
