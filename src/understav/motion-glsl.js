/**
 * Общий шейдерный словарь экранных проходов сцены UNDERSTAV.
 *
 * Главное здесь `screenVelocity`: экранное смещение точки берётся из глубины и двух матриц
 * камеры, а не из поиска похожего блока по картинке. Сцена знает своё движение точно, поэтому
 * смаз верен и на пролёте, и на повороте, и считается для всего кадра одним махом.
 *
 * `viewDistance` отдаёт расстояние в метрах, а не долю до дальней плоскости: дальняя плоскость
 * стоит далеко за сценой, и доля от неё для всего зала осталась бы почти нулём.
 */

export const FULLSCREEN_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const MOTION_GLSL = `
  float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec2 hash22(vec2 p) {
    return vec2(hash21(p), hash21(p + vec2(19.19, 7.77))) * 2.0 - 1.0;
  }

  float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
  }

  float viewDistance(float depth, float near, float far) {
    return (near * far) / (far - (far - near) * depth);
  }

  vec2 screenVelocity(
    vec2 uv,
    float depth,
    mat4 inverseViewProjection,
    mat4 previousViewProjection,
    float limit
  ) {
    vec4 world = inverseViewProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    if (world.w == 0.0) return vec2(0.0);
    vec4 previous = previousViewProjection * vec4(world.xyz / world.w, 1.0);
    if (previous.w <= 0.0) return vec2(0.0);
    vec2 velocity = uv - (previous.xy / previous.w * 0.5 + 0.5);
    float reach = length(velocity);
    return reach > limit ? velocity * (limit / reach) : velocity;
  }
`;
