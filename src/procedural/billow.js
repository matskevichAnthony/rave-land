/**
 * Клубление: альфа материала домножается на движущийся шум с самоискажением.
 *
 * Слоистая дымка держит объём десятком плоскостей, и статичная текстура выдаёт их плашками:
 * пятна едут по кадру целиком, а дым так не ведёт себя никогда. Шум считается в шейдере,
 * потому что клуб обязан жить внутри слоя, а не двигать слой целиком, и потому что так это
 * не стоит ни одного лишнего вызова отрисовки.
 *
 * Правка идёт поверх чужого `onBeforeCompile`, а не вместо него: дымка уже гасится по
 * глубине сцены, и терять гашение ради клуба нельзя.
 */

const MAP_CHUNK = '#include <map_fragment>';

const NOISE_GLSL = `
uniform float uBillowTime;

float billowHash(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453123);
}

float billowNoise(vec2 point) {
  vec2 cell = floor(point);
  vec2 inner = fract(point);
  vec2 smoothed = inner * inner * (3.0 - 2.0 * inner);
  return mix(
    mix(billowHash(cell), billowHash(cell + vec2(1.0, 0.0)), smoothed.x),
    mix(billowHash(cell + vec2(0.0, 1.0)), billowHash(cell + vec2(1.0, 1.0)), smoothed.x),
    smoothed.y
  );
}

float billowFbm(vec2 point) {
  return 0.65 * billowNoise(point) + 0.35 * billowNoise(point * 2.17 + 17.3);
}
`;

/**
 * Материал начинает клубиться; возвращает функцию, которой сцена подаёт время.
 *
 * `scale` это сколько клубов на плоскость, `rise` скорость подъёма в долях плоскости за
 * секунду, `warp` сила самоискажения, `floor` доля плотности, которая остаётся всегда.
 */
export function billowMaterial(material, { scale, rise, warp, floor }) {
  const time = { value: 0 };
  const compiled = material.onBeforeCompile;
  const cacheKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    compiled?.call(material, shader, renderer);
    if (!shader.fragmentShader.includes(MAP_CHUNK)) {
      throw new Error('клубление ждёт материал с картой: шум идёт по её развёртке');
    }
    shader.uniforms.uBillowTime = time;
    shader.fragmentShader = NOISE_GLSL + shader.fragmentShader.replace(
      MAP_CHUNK,
      `${MAP_CHUNK}
  vec2 billowFlow = vec2(uBillowTime * ${(rise * 0.35).toFixed(4)}, -uBillowTime * ${rise.toFixed(4)});
  vec2 billowPoint = vMapUv * ${scale.toFixed(2)} + billowFlow;
  float billowWarp = billowFbm(billowPoint + 4.7);
  float billowDensity = billowFbm(billowPoint + billowWarp * ${warp.toFixed(2)});
  diffuseColor.a *= ${floor.toFixed(2)} + ${(1 - floor).toFixed(2)} * billowDensity * 2.0;`,
    );
  };
  material.customProgramCacheKey = () => `${cacheKey?.() ?? ''}-billow`;

  return function advance(elapsed) {
    time.value = elapsed;
  };
}
