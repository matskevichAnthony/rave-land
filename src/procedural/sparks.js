/**
 * Искры над огнём: одна система точек на все источники сразу.
 *
 * Подъём, снос и угасание считает вершинный шейдер по постоянным атрибутам, поэтому кадру
 * достаётся одно число времени, а не пересборка буфера. Цена системы это один вызов
 * отрисовки независимо от того, сколько очагов ей передали.
 */

import * as THREE from 'three';
import { between } from './random.js';

const SPARKS = {
  count: 240,
  size: 26,
  jitter: 0.26,
  rise: [3.4, 11],
  drift: [0.2, 0.9],
  speed: [0.045, 0.16],
  hot: '#ffb26b',
  cold: '#ff4d0d',
};

const VERTEX = `
#include <common>

uniform float uTime;
uniform float uPulse;
uniform float uSize;
attribute float aSeed;
attribute float aSpeed;
attribute float aRise;
attribute float aDrift;
varying float vLife;

void main() {
  float life = fract(uTime * aSpeed + aSeed);
  vLife = life;
  vec3 lifted = position;
  lifted.y += life * aRise;
  float swirl = (life + aSeed) * PI2;
  lifted.x += sin(swirl) * aDrift * life;
  lifted.z += cos(swirl * 0.7) * aDrift * life;
  vec4 viewPosition = modelViewMatrix * vec4(lifted, 1.0);
  gl_Position = projectionMatrix * viewPosition;
  gl_PointSize = uSize * (1.0 - life * 0.55) * (1.0 + uPulse * 0.3) / max(0.4, -viewPosition.z);
}
`;

// Тонирование и перевод в цветовое пространство экрана дописаны руками: свои материалы
// three собирает сама, а чужой шейдер иначе отдал бы в буфер линейный цвет и потемнел бы.
// Объявления функций при этом не подключаются: рендерер уже кладёт их в шапку шейдера.
const FRAGMENT = `
uniform vec3 uHot;
uniform vec3 uCold;
uniform float uPulse;
varying float vLife;

void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float squared = dot(offset, offset);
  if (squared > 0.25) discard;
  float core = 1.0 - squared * 4.0;
  float fade = (1.0 - vLife) * (1.0 - vLife);
  gl_FragColor = vec4(mix(uHot, uCold, vLife), core * fade * (0.6 + uPulse * 0.4));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSparks({
  random,
  sources,
  count = SPARKS.count,
  size = SPARKS.size,
  jitter = SPARKS.jitter,
  rise = SPARKS.rise,
  drift = SPARKS.drift,
  speed = SPARKS.speed,
  hot = SPARKS.hot,
  cold = SPARKS.cold,
}) {
  const origins = sources.length > 0 ? sources : [[0, 1, 0]];
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const speeds = new Float32Array(count);
  const rises = new Float32Array(count);
  const drifts = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const origin = origins[index % origins.length];
    positions[index * 3] = origin[0] + between(random, -jitter, jitter);
    positions[index * 3 + 1] = origin[1];
    positions[index * 3 + 2] = origin[2] + between(random, -jitter, jitter);
    seeds[index] = random();
    speeds[index] = between(random, ...speed);
    rises[index] = between(random, ...rise);
    drifts[index] = between(random, ...drift);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('aRise', new THREE.BufferAttribute(rises, 1));
  geometry.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPulse: { value: 0 },
      uSize: { value: size },
      uHot: { value: new THREE.Color(hot) },
      uCold: { value: new THREE.Color(cold) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  // Искра уезжает вверх на метры от своей вершины, и коробка геометрии об этом не знает.
  points.frustumCulled = false;

  return {
    object: points,
    update(elapsed, pulse = 0) {
      material.uniforms.uTime.value = elapsed;
      material.uniforms.uPulse.value = pulse;
    },
  };
}
