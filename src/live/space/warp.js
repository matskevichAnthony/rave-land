/**
 * Искажение кадра: то же изображение, но по кривой сетке.
 *
 * Кадр, собранный двумерной частью инструмента, уходит сюда текстурой и становится не
 * картинкой, а поверхностью, по которой можно водить. Разгром рвёт кадр на куски, искажение
 * не трогает в нём ни пикселя и меняет только то, где этот пиксель лежит. Поэтому его можно
 * держать включённым весь сет: читаемость картинки оно не отнимает, а движение даёт всему
 * кадру разом, даже когда в источнике ничего не происходит.
 *
 * Приёмов семь, и ни один не рисует поверх кадра собственного узора. Узор поверх кадра это
 * заставка: сколько его ни крути, он остаётся чужой картинкой, положенной сверху, и через
 * минуту глаз перестаёт его замечать. Смещение чужого не добавляет вовсе, поэтому и не
 * приедается: зал видит своё видео, которое ведёт себя не как видео.
 *
 * Цвет разводится по длине смещения, а не отдельной ручкой. Там, где кадр стоит на месте,
 * каналы совпадают и картинка чистая, где его тянет сильнее всего, они расходятся сами.
 * Это тот самый край стекла, по которому глаз и узнаёт искажение.
 */

import * as THREE from 'three';
import { NOISE_GLSL } from './noise-glsl.js';

export const WARPS = [
  { id: 'none', label: 'Ровно', desc: 'кадр как есть, объём остаётся только на телах' },
  { id: 'liquid', label: 'Течение', desc: 'кадр плывёт по медленному вихрю, как масло на воде' },
  { id: 'lens', label: 'Линза', desc: 'кадр дышит от центра, на удар выдавливает края' },
  { id: 'ripple', label: 'Круги', desc: 'от каждого удара по кадру уходит волна' },
  { id: 'shear', label: 'Сдвиг', desc: 'кадр режется на полосы и разъезжается по горизонтали' },
  { id: 'twist', label: 'Вихрь', desc: 'кадр закручивается вокруг центра тем сильнее, чем дальше от него' },
  { id: 'kaleido', label: 'Калейдоскоп', desc: 'кадр складывается веером вокруг центра, число долей дышит от звука' },
  { id: 'mirror', label: 'Зеркало', desc: 'половина кадра отражается во вторую, ось медленно едет по кругу' },
];

export const DEFAULT_WARP = 'liquid';

const MODES = Object.fromEntries(WARPS.map(({ id }, index) => [id, index]));

// Затухание удара: за сколько кадров толчок садится обратно. Круги живут дольше остальных,
// поэтому у них своя память, отдельная от общего толчка.
const HIT_FALL = 0.06;

// Доля искажения, которая идёт всегда, независимо от звука. Ноль означал бы, что в тихом
// месте приём выключается совсем, и появление его на бочке читается сбоем, а не приёмом.
const IDLE_SHARE = 0.3;

const WARP_SHADER = {
  uniforms: {
    tFrame: { value: null },
    uTime: { value: 0 },
    uLevel: { value: 0 },
    uHit: { value: 0 },
    uWave: { value: 0 },
    uAmount: { value: 0 },
    uMode: { value: MODES[DEFAULT_WARP] },
    uAspect: { value: 1 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tFrame;
    uniform float uTime;
    uniform float uLevel;
    uniform float uHit;
    uniform float uWave;
    uniform float uAmount;
    uniform float uMode;
    uniform float uAspect;
    varying vec2 vUv;

    ${NOISE_GLSL}

    const float LIQUID_SCALE = 2.6;
    const float LIQUID_SPEED = 0.22;
    const float LIQUID_REACH = 0.16;

    const float LENS_RINGS = 5.0;
    const float LENS_SPEED = 1.3;
    const float LENS_REACH = 0.22;

    const float RIPPLE_RINGS = 22.0;
    const float RIPPLE_TAIL = 2.4;
    const float RIPPLE_REACH = 0.12;

    const float SHEAR_BANDS = 14.0;
    const float SHEAR_SPEED = 0.4;
    const float SHEAR_REACH = 0.2;

    const float TWIST_REACH = 1.9;

    const float TAU = 6.2831853;

    // Долей от трёх до десяти: меньше трёх складка не читается веером, больше десяти кадр
    // мельчает до неузнаваемости и остаётся один орнамент.
    const float KALEIDO_MIN = 3.0;
    const float KALEIDO_RANGE = 7.0;
    const float KALEIDO_PUSH = 0.25;

    const float MIRROR_SPIN = 0.11;

    // Разброс каналов на полной длине смещения: дальше этого стекло читается уже браком
    // проектора, а не приёмом.
    const float SPLIT = 0.35;
    // Потолок длины, с которой берётся разброс. У складок смещение меряется половиной экрана, и
    // без потолка они уехали бы в радугу во весь кадр; число взято по самому размашистому из
    // плавных приёмов, где разброс и настраивался.
    const float SPLIT_CAP = 0.22;

    vec2 displace(vec2 uv) {
      vec2 centred = (uv - 0.5) * vec2(uAspect, 1.0);
      float radius = length(centred);
      vec2 outward = radius > 0.0001 ? centred / radius : vec2(0.0);

      if (uMode < 0.5) return vec2(0.0);
      if (uMode < 1.5) return flow2(uv * LIQUID_SCALE, uTime * LIQUID_SPEED) * LIQUID_REACH;
      if (uMode < 2.5) {
        float breath = sin(radius * LENS_RINGS - uTime * LENS_SPEED);
        return outward * breath * (radius + uHit) * LENS_REACH;
      }
      if (uMode < 3.5) {
        float wave = sin(radius * RIPPLE_RINGS - uWave * RIPPLE_RINGS);
        return outward * wave * exp(-radius * RIPPLE_TAIL) * RIPPLE_REACH;
      }
      if (uMode < 4.5) {
        float band = floor(uv.y * SHEAR_BANDS);
        float side = noise3(vec3(band, uTime * SHEAR_SPEED, 0.0));
        return vec2(side * SHEAR_REACH, 0.0);
      }
      if (uMode < 5.5) {
        float spin = (1.0 - radius) * TWIST_REACH * sin(uTime * 0.4);
        return vec2(
          centred.x * cos(spin) - centred.y * sin(spin) - centred.x,
          centred.x * sin(spin) + centred.y * cos(spin) - centred.y
        );
      }
      // Складка считается в углах, а не в смещениях: доля берётся по остатку от деления угла, а
      // отражение внутри доли даёт модуль. Наружу она всё равно уходит смещением, поэтому весь
      // остальной проход о ней ничего не знает и работает как со всеми прочими приёмами.
      if (uMode < 6.5) {
        float wedge = TAU / (KALEIDO_MIN + floor(uLevel * KALEIDO_RANGE));
        float slice = abs(mod(atan(centred.y, centred.x) + wedge * 0.5, wedge) - wedge * 0.5);
        vec2 folded = vec2(cos(slice), sin(slice)) * radius * (1.0 + uHit * KALEIDO_PUSH);
        return folded / vec2(uAspect, 1.0) + 0.5 - uv;
      }
      float tilt = uTime * MIRROR_SPIN;
      float lean = sin(tilt);
      float rise = cos(tilt);
      vec2 turned = vec2(centred.x * rise + centred.y * lean, centred.y * rise - centred.x * lean);
      turned.x = abs(turned.x);
      // На удар зеркало доворачивается второй осью и кадр складывается вчетверо. Смесь, а не
      // ветка: на половине удара половина складки, и приход виден движением самой оси.
      turned.y = mix(turned.y, -abs(turned.y), uHit);
      vec2 back = vec2(turned.x * rise - turned.y * lean, turned.y * rise + turned.x * lean);
      return back / vec2(uAspect, 1.0) + 0.5 - uv;
    }

    void main() {
      vec2 shift = displace(vUv) * uAmount * (${IDLE_SHARE.toFixed(2)} + uLevel * ${(1 - IDLE_SHARE).toFixed(2)});
      vec2 uv = clamp(vUv + shift, vec2(0.0), vec2(1.0));
      vec2 split = clamp(shift, -SPLIT_CAP, SPLIT_CAP) * SPLIT;
      gl_FragColor = vec4(
        texture2D(tFrame, clamp(uv + split, vec2(0.0), vec2(1.0))).r,
        texture2D(tFrame, uv).g,
        texture2D(tFrame, clamp(uv - split, vec2(0.0), vec2(1.0))).b,
        1.0
      );
    }
  `,
};

export function createWarp(texture) {
  const material = new THREE.ShaderMaterial({
    ...WARP_SHADER,
    uniforms: THREE.UniformsUtils.clone(WARP_SHADER.uniforms),
    depthTest: false,
    depthWrite: false,
  });
  material.uniforms.tFrame.value = texture;

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.Camera();

  let hit = 0;
  let wave = 0;

  return {
    scene,
    camera,
    setMode(id) {
      material.uniforms.uMode.value = MODES[id] ?? 0;
    },
    /**
     * Кадр искажения.
     *
     * Волна кругов идёт от удара и дальше живёт своим ходом: если гнать её временем, круги
     * бегут по экрану непрерывно и превращаются в фон, а от удара должна уходить одна.
     */
    step({ time, level, amount, aspect, punched }) {
      const uniforms = material.uniforms;
      if (punched) {
        hit = 1;
        wave = 0;
      } else {
        hit += (0 - hit) * HIT_FALL;
      }
      wave += 0.02;
      uniforms.uTime.value = time;
      uniforms.uLevel.value = level;
      uniforms.uHit.value = hit;
      uniforms.uWave.value = wave;
      uniforms.uAmount.value = amount;
      uniforms.uAspect.value = aspect;
    },
  };
}
