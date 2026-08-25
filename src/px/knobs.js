// The parameter space every painter reads from. A seed alone was too narrow —
// six numbers meant every roll of the dice looked like the last one — so each
// knob here has a tame range and a wild one, and CHAOS slides between them.
// The result is plain JSON: the code generator emits it as a literal.
import { seededRng } from './rng.js';

export const CHAOS_LEVELS = {
  off: { label: 'OFF', value: 0 },
  low: { label: 'LOW', value: 0.25 },
  mid: { label: 'MID', value: 0.55 },
  high: { label: 'HIGH', value: 0.8 },
  max: { label: 'MAX', value: 1 },
};

export const CHAOS_DEFAULT = 'off';

// knob: [tameMin, tameMax, wildMin, wildMax]
export const RANGES = {
  density: [0.4, 0.6, 0.05, 0.95],
  complexity: [0.4, 0.6, 0.05, 1],
  scale: [0.85, 1.2, 0.25, 4],
  warp: [0, 0.15, 0, 1],
  drift: [0.8, 1.2, -1.5, 1.5],
  jitter: [0, 0.05, 0, 1],
  bias: [-0.05, 0.05, -0.5, 0.5],
  skew: [-0.1, 0.1, -1, 1],
  churn: [0.1, 0.35, 0, 1],
  gate: [0.9, 1, 0.25, 1],
  hotRate: [0.02, 0.1, 0, 0.6],
  decay: [0.15, 0.4, 0, 1],
};

export const MIRROR_KNOB = 'mirror';

// What each knob does to a picture, in the words the controls use.
export const KNOB_LABELS = {
  density: 'DENSITY',
  complexity: 'COMPLEXITY',
  scale: 'SCALE',
  warp: 'WARP',
  drift: 'DRIFT',
  jitter: 'JITTER',
  bias: 'BIAS',
  skew: 'SKEW',
  churn: 'CHURN',
  gate: 'GATE',
  hotRate: 'HOT',
  decay: 'DECAY',
  [MIRROR_KNOB]: 'MIRROR',
};

export const KNOB_NAMES = Object.keys(KNOB_LABELS);

const MIRROR_MODES = 4;
const MIRROR_ODDS = 0.7;
const SEED_NUM_RANGE = 1e6;
const PRECISION = 1000;

const lerp = (a, b, t) => a + (b - a) * t;
const round = x => Math.round(x * PRECISION) / PRECISION;

const knob = (rng, [tameMin, tameMax, wildMin, wildMax], level) => {
  const lo = lerp(tameMin, wildMin, level);
  const hi = lerp(tameMax, wildMax, level);
  return round(lo + rng() * (hi - lo));
};

// Returns the full params object a painter is handed.
//
// `spread` is how far the seed is allowed to wander, 0 (tame) to 1 (full
// chaos). Pass a number to widen every knob together, or a per-knob map to
// widen them one at a time — a knob left at 0 stays near its tame middle while
// its neighbour runs wild. It sets the width of the band, never the value: the
// seed always picks the point inside it, so widening a knob makes the result
// less predictable rather than merely different.
export function chaosParams(seed, spread = 0) {
  const rng = seededRng(seed);
  const widthOf = name => (typeof spread === 'number' ? spread : (spread[name] ?? 0));
  const params = {};
  for (const [name, range] of Object.entries(RANGES)) params[name] = knob(rng, range, widthOf(name));
  for (const name of ['a', 'b', 'c', 'd', 'e', 'f']) params[name] = round(rng());
  const mirrorWidth = widthOf(MIRROR_KNOB);
  params.mirror = rng() < mirrorWidth * MIRROR_ODDS ? 1 + Math.floor(rng() * (MIRROR_MODES - 1)) : 0;
  params.seedNum = Math.floor(rng() * SEED_NUM_RANGE);
  params.chaos = round(KNOB_NAMES.reduce((sum, name) => sum + widthOf(name), 0) / KNOB_NAMES.length);
  return params;
}
