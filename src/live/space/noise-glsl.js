/**
 * Шум для объёмного слоя: одна реализация на искажение кадра и на морф тел.
 *
 * Шум градиентный, а не симплексный, и это осознанный размен. Симплекс честнее и дороже,
 * а здесь он считается по вершине на каждом теле и по пикселю на весь экран, кадр за кадром,
 * шестьдесят раз в секунду. На глаз разницы между ними в мятой поверхности нет никакой,
 * а разница в цене видна на счётчике кадров сразу.
 *
 * Октав три. Одна даёт ровную волну, которая читается как заставка, четыре превращают
 * поверхность в песок, в котором форма тела уже не угадывается.
 */

export const NOISE_GLSL = `
  vec3 hash33(vec3 p) {
    p = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6))
    );
    return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
  }

  float noise3(vec3 p) {
    vec3 cell = floor(p);
    vec3 part = fract(p);
    vec3 ease = part * part * (3.0 - 2.0 * part);
    float x00 = mix(
      dot(hash33(cell + vec3(0.0, 0.0, 0.0)), part - vec3(0.0, 0.0, 0.0)),
      dot(hash33(cell + vec3(1.0, 0.0, 0.0)), part - vec3(1.0, 0.0, 0.0)), ease.x);
    float x10 = mix(
      dot(hash33(cell + vec3(0.0, 1.0, 0.0)), part - vec3(0.0, 1.0, 0.0)),
      dot(hash33(cell + vec3(1.0, 1.0, 0.0)), part - vec3(1.0, 1.0, 0.0)), ease.x);
    float x01 = mix(
      dot(hash33(cell + vec3(0.0, 0.0, 1.0)), part - vec3(0.0, 0.0, 1.0)),
      dot(hash33(cell + vec3(1.0, 0.0, 1.0)), part - vec3(1.0, 0.0, 1.0)), ease.x);
    float x11 = mix(
      dot(hash33(cell + vec3(0.0, 1.0, 1.0)), part - vec3(0.0, 1.0, 1.0)),
      dot(hash33(cell + vec3(1.0, 1.0, 1.0)), part - vec3(1.0, 1.0, 1.0)), ease.x);
    return mix(mix(x00, x10, ease.y), mix(x01, x11, ease.y), ease.z);
  }

  float fbm3(vec3 p) {
    return noise3(p) * 0.55 + noise3(p * 2.03) * 0.3 + noise3(p * 4.11) * 0.15;
  }

  vec2 flow2(vec2 p, float time) {
    return vec2(
      fbm3(vec3(p, time)),
      fbm3(vec3(p.yx + vec2(17.3, 5.7), time + 3.1))
    );
  }
`;
