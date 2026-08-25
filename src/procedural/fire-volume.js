import * as THREE from 'three';

/**
 * Объёмный огонь: луч идёт сквозь коробку и набирает в ней плотность пламени.
 *
 * Это порт THREE.Fire (Masatatsu Nakamura, MIT, https://github.com/mattatz/THREE.Fire) на
 * современный three: шейдер оставлен как в оригинале, поменялось только то, чего в новой
 * версии движка больше нет (обратная матрица, цветовое пространство текстуры, модульный
 * вывод вместо THREE.Fire в глобальном объекте). Метод из статьи Fuller et al. про
 * процедурный объёмный огонь: пламя это не картинка на щите, а плотность вдоль луча, поэтому
 * оно не разворачивается за камерой и не гаснет при облёте сбоку.
 *
 * Огонь стоит пикселей, а не треугольников: коробка это двенадцать треугольников, а работа
 * идёт в пикселе, двадцать шагов луча по три октавы шума. Крупный огонь в полкадра дорог,
 * мелкий в углу почти бесплатен.
 */

const RAY_STEPS = 20;
const NOISE_OCTAVES = 3;
// Шаг луча в долях габарита коробки: двадцать шагов проходят её насквозь с запасом.
const RAY_STEP_FACTOR = 0.0288;

const FIRE_TEXTURE_URL = 'assets/textures/fire-ramp.png';

let rampTexture = null;

/** Растяжка огня из оригинального ассета: одна на страницу, сколько бы костров ни завели. */
function fireRamp() {
  if (rampTexture) return rampTexture;
  rampTexture = new THREE.TextureLoader().load(FIRE_TEXTURE_URL);
  rampTexture.magFilter = THREE.LinearFilter;
  rampTexture.minFilter = THREE.LinearFilter;
  rampTexture.wrapS = THREE.ClampToEdgeWrapping;
  rampTexture.wrapT = THREE.ClampToEdgeWrapping;
  // Растяжка это не картинка, а таблица значений: в оригинале её байты шли в кадр как есть,
  // и перевод из sRGB в линейное пространство просто съедает огню яркость.
  rampTexture.colorSpace = THREE.NoColorSpace;
  return rampTexture;
}

const VERTEX_SHADER = /* glsl */`
varying vec3 vWorldPos;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
}
`;

const FRAGMENT_SHADER = /* glsl */`
uniform vec3 color;
uniform float time;
uniform float seed;
uniform mat4 invModelMatrix;
uniform vec3 scale;
uniform vec4 noiseScale;
uniform float magnitude;
uniform float lacunarity;
uniform float gain;
uniform sampler2D fireTex;

varying vec3 vWorldPos;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
    i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float turbulence(vec3 p) {
  float sum = 0.0;
  float freq = 1.0;
  float amp = 1.0;
  for (int i = 0; i < OCTAVES; i++) {
    sum += abs(snoise(p * freq)) * amp;
    freq *= lacunarity;
    amp *= gain;
  }
  return sum;
}

vec4 samplerFire(vec3 p, vec4 noise) {
  vec2 st = vec2(sqrt(dot(p.xz, p.xz)), p.y);
  if (st.x <= 0.0 || st.x >= 1.0 || st.y <= 0.0 || st.y >= 1.0) return vec4(0.0);

  p.y -= (seed + time) * noise.w;
  p *= noise.xyz;
  st.y += sqrt(st.y) * magnitude * turbulence(p);
  if (st.y <= 0.0 || st.y >= 1.0) return vec4(0.0);

  return texture2D(fireTex, st);
}

vec3 localize(vec3 p) {
  return (invModelMatrix * vec4(p, 1.0)).xyz;
}

void main() {
  vec3 rayPos = vWorldPos;
  vec3 rayDir = normalize(rayPos - cameraPosition);
  float rayLen = RAY_STEP * length(scale.xyz);

  vec4 col = vec4(0.0);
  for (int i = 0; i < ITERATIONS; i++) {
    rayPos += rayDir * rayLen;
    vec3 lp = localize(rayPos);
    lp.y += 0.5;
    lp.xz *= 2.0;
    col += samplerFire(lp, noiseScale);
  }
  // Прозрачность идёт от плотности, а не от яркости: в оригинале множитель цвета близок к
  // единице, и разницы нет, а тут он держит огонь в пределах кадра. Считай альфу после него,
  // и пламя, посаженное по яркости, заодно стало бы прозрачным, то есть без силуэта.
  col.a = col.r;
  gl_FragColor = vec4(col.rgb * color, col.a);
}
`;

/**
 * Костёр в коробке. `size` это габарит пламени в метрах, `seed` его фаза.
 *
 * Форма пламени живёт в шейдере, поэтому наружу отдаются только коробка и `update`: время и
 * обратная матрица нужны шейдеру каждый кадр, а сам он о сцене ничего не знает.
 */
export function createFireVolume({ size, color, seed = 0, noise = {} }) {
  const material = new THREE.ShaderMaterial({
    defines: { ITERATIONS: String(RAY_STEPS), OCTAVES: String(NOISE_OCTAVES), RAY_STEP: RAY_STEP_FACTOR.toFixed(4) },
    uniforms: {
      fireTex: { value: fireRamp() },
      color: { value: new THREE.Color(color) },
      time: { value: 0 },
      seed: { value: seed },
      invModelMatrix: { value: new THREE.Matrix4() },
      scale: { value: new THREE.Vector3(1, 1, 1) },
      noiseScale: { value: new THREE.Vector4(
        noise.x ?? 1,
        noise.y ?? 2,
        noise.z ?? 1,
        noise.speed ?? 0.3,
      ) },
      magnitude: { value: noise.magnitude ?? 1.3 },
      lacunarity: { value: noise.lacunarity ?? 2 },
      gain: { value: noise.gain ?? 0.5 },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.scale.set(size.width, size.height, size.width);
  mesh.frustumCulled = true;

  return {
    mesh,
    update(elapsed) {
      mesh.updateMatrixWorld();
      material.uniforms.invModelMatrix.value.copy(mesh.matrixWorld).invert();
      material.uniforms.scale.value.copy(mesh.scale);
      material.uniforms.time.value = elapsed;
    },
  };
}
