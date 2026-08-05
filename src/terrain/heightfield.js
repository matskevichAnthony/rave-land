import { createNoise2D } from 'simplex-noise';

const OCTAVES = 4;
const BASE_FREQUENCY = 1 / 70;

export function mulberry32(seed) {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

export function createHeightAt(params) {
  const noise2D = createNoise2D(mulberry32(params.seed));
  const { amplitude, plateauRadius } = params;

  return (x, z) => {
    let height = 0;
    let frequency = BASE_FREQUENCY;
    let gain = 1;
    for (let i = 0; i < OCTAVES; i += 1) {
      height += noise2D(x * frequency, z * frequency) * gain;
      frequency *= 2;
      gain *= 0.5;
    }
    const distanceFromCenter = Math.hypot(x, z);
    const plateauFade = smoothstep(plateauRadius, plateauRadius * 2.4, distanceFromCenter);
    return height * amplitude * plateauFade;
  };
}
