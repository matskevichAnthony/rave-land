// The image half of PX·77: twelve algorithms, one still frame each. Every
// source is pure — (ctx, w, h, p, palette) with no Math.random and no Date — so
// a seed always paints the same picture and the degrade stage always has the
// same thing to eat.
//
// p comes from machine/chaos.js (see RANGES there for every knob and its
// range). Sources read the wide knobs defensively, so a bare
// { density, complexity, a, b, c, d } still renders.
//
// All colour is black → main → hot and nothing else. Eight palettes look like
// one machine because no source ever invents a hue of its own.
import { mulberry32 } from './rng.js';

const TAU = Math.PI * 2;
const TONE_STEPS = 256;
// where `main` sits on the black→hot ramp: late, so most of the frame is the
// palette's own colour and `hot` stays a rare accent rather than a wash
const MAIN_STOP = 0.68;

const KNOB_FALLBACKS = {
  density: 0.5,
  complexity: 0.5,
  scale: 1,
  warp: 0,
  drift: 1,
  jitter: 0,
  bias: 0,
  skew: 0,
  churn: 0.25,
  gate: 1,
  hotRate: 0.06,
  decay: 0.3,
  a: 0.5,
  b: 0.5,
  c: 0.5,
  d: 0.5,
  e: 0.5,
  f: 0.5,
  mirror: 0,
  seedNum: 0,
};

const knobs = p => ({ ...KNOB_FALLBACKS, ...p });

const frac = x => x - Math.floor(x);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

function toneTable({ main, hot }) {
  const m = rgbOf(main);
  const h = rgbOf(hot);
  const table = new Uint8ClampedArray(TONE_STEPS * 3);
  for (let i = 0; i < TONE_STEPS; i++) {
    const t = i / (TONE_STEPS - 1);
    const k = t < MAIN_STOP ? t / MAIN_STOP : (t - MAIN_STOP) / (1 - MAIN_STOP);
    for (let c = 0; c < 3; c++) {
      table[i * 3 + c] = t < MAIN_STOP ? m[c] * k : lerp(m[c], h[c], k);
    }
  }
  return table;
}

const toneCss = (tone, t) => {
  const i = Math.round(clamp01(t) * (TONE_STEPS - 1)) * 3;
  return `rgb(${tone[i]},${tone[i + 1]},${tone[i + 2]})`;
};

const ground = (ctx, w, h) => {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
};

// Runs the orbit once in the rotated frame it will be drawn in, and reports the
// box it occupies. Returns null unless the orbit has real structure: plenty of
// constants settle into a short cycle, and a handful of points has a perfectly
// good bounding box — fitting it just blows two dots up to fill the frame.
function measureOrbit(step, cosR, sinR) {
  const xs = new Float64Array(ATTRACTOR_PROBE);
  const ys = new Float64Array(ATTRACTOR_PROBE);
  let x = 0.1;
  let y = 0.1;
  let loX = Infinity;
  let hiX = -Infinity;
  let loY = Infinity;
  let hiY = -Infinity;
  let kept = 0;
  for (let i = 0; i < ATTRACTOR_PROBE; i++) {
    [x, y] = step(x, y);
    if (i < ATTRACTOR_WARMUP || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const rx = x * cosR - y * sinR;
    const ry = x * sinR + y * cosR;
    xs[kept] = rx;
    ys[kept] = ry;
    kept++;
    if (rx < loX) loX = rx;
    if (rx > hiX) hiX = rx;
    if (ry < loY) loY = ry;
    if (ry > hiY) hiY = ry;
  }
  const reach = Math.max(hiX - loX, hiY - loY);
  if (!kept || !Number.isFinite(reach) || reach < ATTRACTOR_MIN_REACH) return null;

  const cells = new Set();
  for (let i = 0; i < kept; i++) {
    const gx = Math.floor(((xs[i] - loX) / reach) * ATTRACTOR_PROBE_GRID);
    const gy = Math.floor(((ys[i] - loY) / reach) * ATTRACTOR_PROBE_GRID);
    cells.add(gy * (ATTRACTOR_PROBE_GRID + 1) + gx);
  }
  if (cells.size < ATTRACTOR_MIN_CELLS) return null;
  return { reach, midX: (loX + hiX) / 2, midY: (loY + hiY) / 2 };
}

// A source that thinks in a grid computes into a Float32Array of 0..1 and hands
// it here to be inked and stretched over the frame.
function paintField(ctx, w, h, field, fw, fh, tone, smooth = true) {
  const buffer = document.createElement('canvas');
  buffer.width = fw;
  buffer.height = fh;
  const image = ctx.createImageData(fw, fh);
  const px = image.data;
  for (let i = 0; i < fw * fh; i++) {
    const t = Math.round(clamp01(field[i]) * (TONE_STEPS - 1)) * 3;
    px[i * 4] = tone[t];
    px[i * 4 + 1] = tone[t + 1];
    px[i * 4 + 2] = tone[t + 2];
    px[i * 4 + 3] = 255;
  }
  buffer.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(buffer, 0, 0, fw, fh, 0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
}

// p.mirror is a whole-frame verdict, so every source folds the same way rather
// than each one growing its own symmetry code.
function fold(ctx, w, h, mode) {
  if (!mode) return;
  if (mode === 1 || mode === 3) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(ctx.canvas, 0, 0, w / 2, h, -w, 0, w / 2, h);
    ctx.restore();
  }
  if (mode === 2 || mode === 3) {
    ctx.save();
    ctx.scale(1, -1);
    ctx.drawImage(ctx.canvas, 0, 0, w, h / 2, 0, -h, w, h / 2);
    ctx.restore();
  }
}

const hash2 = (x, y, seed) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

function noise2(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash2(xi, yi, seed), hash2(xi + 1, yi, seed), u),
    lerp(hash2(xi, yi + 1, seed), hash2(xi + 1, yi + 1, seed), u),
    v);
}

function fbm(x, y, seed, octaves) {
  let sum = 0;
  let amp = 0.5;
  let total = 0;
  let fx = x;
  let fy = y;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(fx, fy, seed + o * 19) * amp;
    total += amp;
    fx *= 2;
    fy *= 2;
    amp *= 0.5;
  }
  return sum / total;
}

// The shape of the noise a source is built on, not merely its frequency. A seed
// that can only move numbers gives you the same picture at a different size;
// a seed that picks the field itself gives you a different picture.
const FIELD_KINDS = [
  (x, y, seed, oct) => fbm(x, y, seed, oct),
  (x, y, seed, oct) => 1 - Math.abs(fbm(x, y, seed, oct) * 2 - 1),
  (x, y, seed, oct) => Math.abs(fbm(x, y, seed, oct) * 2 - 1),
  (x, y, seed, oct) => fbm(
    x + fbm(x * 0.5, y * 0.5, seed + 31, 2) * 3,
    y - fbm(x * 0.5 + 2.7, y * 0.5, seed + 53, 2) * 3,
    seed, oct),
  (x, y, seed, oct) => clamp01(fbm(x, y, seed, oct) * 0.6
    + (Math.sin(x * 2.2) * Math.sin(y * 2.2) * 0.5 + 0.5) * 0.4),
  (x, y, seed, oct) => clamp01(frac(fbm(x, y, seed, oct) * 2.6) * 0.7 + fbm(x, y, seed + 7, 1) * 0.3),
];

const fieldKindFor = f => FIELD_KINDS[Math.floor(clamp01(f) * FIELD_KINDS.length) % FIELD_KINDS.length];

// Gray-Scott only lives in a narrow strip of the feed/kill plane, and only part
// of that strip blooms inside this step budget: the low-feed regimes (0.014 to
// 0.025) are real, but they need tens of thousands of steps to come alive, and
// inside a couple of thousand they are a black square.
const REACTION_RECIPES = [
  { feed: 0.037, kill: 0.06 },
  { feed: 0.03, kill: 0.062 },
  { feed: 0.0545, kill: 0.062 },
  { feed: 0.062, kill: 0.0609 },
  { feed: 0.042, kill: 0.059 },
];

// Where the emitters stand is the composition; scattering them is only one
// arrangement out of several, and the seed should get to pick.
const EMITTER_LAYOUTS = [
  (rng, w, h, i, n) => ({ x: rng() * w, y: rng() * h }),
  (rng, w, h, i, n) => ({
    x: w / 2 + Math.cos((i / n) * TAU) * w * 0.35,
    y: h / 2 + Math.sin((i / n) * TAU) * h * 0.35,
  }),
  (rng, w, h, i, n) => {
    const side = Math.ceil(Math.sqrt(n));
    return { x: ((i % side) + 0.5) * (w / side), y: (Math.floor(i / side) + 0.5) * (h / side) };
  },
  (rng, w, h, i, n) => ({ x: (i / Math.max(1, n - 1)) * w, y: h / 2 + Math.sin(i) * h * 0.1 }),
];

const SHARD_METRICS = [
  (dx, dy) => dx * dx + dy * dy,
  (dx, dy) => dx + dy,
  (dx, dy) => (dx > dy ? dx : dy),
];

const LSYSTEM_RULES = [
  'F[+F]F[-F]F',
  'FF-[-F+F+F]+[+F-F-F]',
  'F[+F]F[-F]+F',
  'F-[[F]+F]+F[+FF]-F',
  'FF+[+F-F-F]-[-F+F+F]',
  'F[++F][--F]FF[+F][-F]F',
];

const REACTION_GRID_DIVISOR = 6;
const REACTION_GRID_MAX = 128;
const REACTION_STEPS_MIN = 1200;
const REACTION_STEPS_MAX = 2200;
const REACTION_DIFF_B_MIN = 0.46;
const REACTION_DIFF_B_SPAN = 0.12;
const REACTION_SEED_A = 0.5;
const REACTION_SEED_B = 0.25;
const GROWTH_GRID_DIVISOR = 2.8;
const GROWTH_GRID_MAX = 224;
const GROWTH_NUCLEI_SPREAD = 0.05;
const GROWTH_WIND = 0.16;
const GROWTH_DUST_MIN = 0.18;
const GROWTH_DUST_SPAN = 0.14;
const GROWTH_STEPS_MIN = 300;
const GROWTH_STEPS_SPAN = 500;
const ATTRACTOR_PROBE = 4000;
const ATTRACTOR_WARMUP = 50;
const ATTRACTOR_FIT = 0.92;
const ATTRACTOR_MIN_REACH = 0.05;
// an orbit that never passes near the trap radius leaves trap high everywhere,
// and the whole interior went black; the floor keeps the set on the frame
const ESCAPE_INTERIOR_FLOOR = 0.22;
const ESCAPE_MIN_ITER = 40;
const ESCAPE_ITER_SPAN = 60;
const CONTOUR_JITTER = 0.03;
const CONTOUR_WASH = 0.12;
const ESCAPE_EDGE_MIN = 0.995;
const ESCAPE_EDGE_SPAN = 0.02;
const ESCAPE_TRAP_BASE = 4;
const ESCAPE_TRAP_SPAN = 8;
const ESCAPE_CURVE = 0.32;
const ESCAPE_BIAS_BEND = 0.4;
const ESCAPE_CURVE_MIN = 0.12;
const ESCAPE_CURVE_MAX = 1.6;
const ATTRACTOR_PROBE_GRID = 96;
const ATTRACTOR_MIN_CELLS = 400;
const ATTRACTOR_FALLBACK = [1.4, -2.3, 2.4, -2.1];
const SHARD_TILE = 64;
const LSYSTEM_LIMIT = 2e5;

const MUTANT_MIN_DEPTH = 4;
const MUTANT_DEPTH_SPAN = 4;
const MUTANT_PROBE = 24;
const MUTANT_MIN_RANGE = 0.05;
const MUTANT_MIN_LEVELS = 6;
const MUTANT_LEVEL_STEPS = 24;
const MUTANT_TRIES = 24;

// The leaves a formula can reach for: where the pixel is, in every frame of
// reference the plane offers.
const MUTANT_LEAVES = [
  () => (x) => x,
  () => (x, y) => y,
  () => (x, y) => Math.hypot(x, y),
  () => (x, y) => Math.atan2(y, x) / Math.PI,
  (rng) => { const k = rng() * 2 - 1; return () => k; },
  (rng) => { const s = Math.floor(rng() * 1e6); return (x, y) => noise2(x * 3, y * 3, s) * 2 - 1; },
];

// ...and the ways it can fold them together. Each one takes sub-formulas and
// returns a new one, so a tree of these IS the algorithm.
const MUTANT_BRANCHES = [
  (rng, a, b) => (x, y) => a(x, y) + b(x, y),
  (rng, a, b) => (x, y) => a(x, y) * b(x, y),
  (rng, a, b) => (x, y) => a(x, y) - b(x, y),
  (rng, a) => { const k = 1 + rng() * 9; return (x, y) => Math.sin(a(x, y) * k); },
  (rng, a) => { const k = 1 + rng() * 9; return (x, y) => Math.cos(a(x, y) * k); },
  (rng, a) => (x, y) => Math.abs(a(x, y)),
  (rng, a, b) => (x, y) => Math.min(a(x, y), b(x, y)),
  (rng, a, b) => (x, y) => Math.max(a(x, y), b(x, y)),
  (rng, a, b) => { const k = 0.2 + rng() * 1.8; return (x, y) => frac(a(x, y) * b(x, y) / k) * 2 - 1; },
  (rng, a, b) => (x, y) => Math.atan2(a(x, y), b(x, y)) / Math.PI,
  (rng, a, b) => (x, y) => (a(x, y) > b(x, y) ? 1 : -1),
  // domain warp: one formula decides where the other one is read
  (rng, a, b) => { const k = 0.3 + rng() * 1.2; return (x, y) => a(x + b(x, y) * k, y - b(y, x) * k); },
];

function growFormula(rng, depth) {
  if (depth <= 0 || rng() < 0.12) return MUTANT_LEAVES[Math.floor(rng() * MUTANT_LEAVES.length)](rng);
  const branch = MUTANT_BRANCHES[Math.floor(rng() * MUTANT_BRANCHES.length)];
  return branch(rng, growFormula(rng, depth - 1), growFormula(rng, depth - 1));
}

// A formula written at random is usually a dud: it saturates, or collapses to a
// constant, or paints two flat halves. Sample it coarsely and keep growing new
// ones until one has something to look at — the same lesson every other source
// here learned, only this time the algorithm itself is what gets rerolled.
function growLivelyFormula(rng, depth) {
  let last = null;
  for (let attempt = 0; attempt < MUTANT_TRIES; attempt++) {
    const formula = growFormula(rng, depth);
    last = formula;
    let lo = Infinity;
    let hi = -Infinity;
    const levels = new Set();
    for (let gy = 0; gy < MUTANT_PROBE; gy++) {
      for (let gx = 0; gx < MUTANT_PROBE; gx++) {
        const v = formula((gx / MUTANT_PROBE) * 2 - 1, (gy / MUTANT_PROBE) * 2 - 1);
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        levels.add(Math.round(clamp01((v + 1) / 2) * MUTANT_LEVEL_STEPS));
      }
    }
    if (hi - lo >= MUTANT_MIN_RANGE && levels.size >= MUTANT_MIN_LEVELS) return formula;
  }
  return last;
}

export const SOURCES = {
  mutant: {
    label: 'MUTANT',
    desc: 'a formula the machine writes itself — a different algorithm every seed',
    wild: 'formula',
    render: (ctx, w, h, p, palette) => {
      const { complexity, scale, bias, gate, hotRate, seedNum, mirror } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 11);
      const depth = MUTANT_MIN_DEPTH + Math.round(complexity * MUTANT_DEPTH_SPAN);
      const formula = growLivelyFormula(rng, depth);
      const span = Math.min(w, h);
      const zoom = 2 / (0.5 + scale * 0.8);
      const field = new Float32Array(w * h);
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = 0; y < h; y++) {
        const uy = ((y - h / 2) / span) * zoom;
        for (let x = 0; x < w; x++) {
          const ux = ((x - w / 2) / span) * zoom;
          const v = formula(ux, uy);
          const safe = Number.isFinite(v) ? v : 0;
          field[y * w + x] = safe;
          if (safe < lo) lo = safe;
          if (safe > hi) hi = safe;
        }
      }
      // the formula's own range is unknowable in advance, so the frame is fitted
      // to whatever it turned out to be
      const reach = hi - lo || 1;
      const posterise = 1 + Math.round(gate * MUTANT_LEVEL_STEPS);
      for (let i = 0; i < field.length; i++) {
        const t = clamp01((field[i] - lo) / reach + bias * 0.3);
        field[i] = Math.round(t * posterise) / posterise;
        if (field[i] > 1 - hotRate) field[i] = 1;
      }
      paintField(ctx, w, h, field, w, h, tone, false);
      fold(ctx, w, h, mirror);
    },
  },

  flow: {
    label: 'FLOW',
    desc: 'ink dragged through a curl field until it forgets where it started',
    wild: 'rules',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, warp, drift, jitter, skew, churn, gate, hotRate, decay, seedNum, mirror, a, f } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 1);
      const fieldAt = fieldKindFor(f);
      const span = Math.min(w, h);
      ground(ctx, w, h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      const strands = Math.round(500 + density * 2200);
      const steps = Math.round(30 + churn * 90);
      const freq = (1.2 + a * 3) * scale / span;
      const octaves = 2 + Math.round(complexity * 3);
      const step = span * 0.004 * (0.5 + complexity);
      ctx.lineWidth = 0.6 + (1 - density) * 2.2;
      ctx.globalAlpha = 0.12 + decay * 0.4;
      for (let i = 0; i < strands; i++) {
        const t0 = 0.3 + rng() * 0.4;
        let x = rng() * w;
        let y = rng() * h;
        const hot = rng() < hotRate;
        if (rng() > gate) continue;
        ctx.strokeStyle = toneCss(tone, hot ? 1 : t0);
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let s = 0; s < steps; s++) {
          const angle = (fieldAt(x * freq, y * freq, seedNum, octaves) * 2 - 1) * TAU * (1 + warp * 2)
            + skew * 2
            + (rng() - 0.5) * jitter;
          x += Math.cos(angle) * step * drift;
          y += Math.sin(angle) * step * drift;
          if (x < 0 || y < 0 || x > w || y > h) break;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      fold(ctx, w, h, mirror);
    },
  },

  reaction: {
    label: 'REACTION',
    desc: 'two chemicals eating each other into coral',
    wild: 'rules',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, churn, bias, gate, seedNum, mirror, a, b } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 2);
      const g = clamp(Math.round(Math.sqrt(w * h) / REACTION_GRID_DIVISOR), 48, REACTION_GRID_MAX);
      const recipe = REACTION_RECIPES[Math.floor(clamp01(a) * REACTION_RECIPES.length) % REACTION_RECIPES.length];
      const feed = recipe.feed + (b - 0.5) * 0.003;
      const kill = recipe.kill + (bias) * 0.002;
      const steps = Math.round(REACTION_STEPS_MIN + churn * (REACTION_STEPS_MAX - REACTION_STEPS_MIN));
      const dA = 1;
      const dB = REACTION_DIFF_B_MIN + complexity * REACTION_DIFF_B_SPAN;
      const size = g * g;
      let A = new Float32Array(size).fill(1);
      let B = new Float32Array(size);
      const seeds = 3 + Math.round(density * 12);
      for (let i = 0; i < seeds; i++) {
        const cx = Math.floor(rng() * g);
        const cy = Math.floor(rng() * g);
        const r = 2 + Math.floor(rng() * (g * 0.06 + 2));
        for (let y = cy - r; y <= cy + r; y++) {
          for (let x = cx - r; x <= cx + r; x++) {
            const xi = (x + g) % g;
            const yi = (y + g) % g;
            if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
            // A full-strength blob burns A away in a single step and the
            // reaction dies with it; the half-and-quarter seed is what keeps
            // gray-scott inside the regime where fronts propagate.
            A[yi * g + xi] = REACTION_SEED_A;
            B[yi * g + xi] = REACTION_SEED_B;
          }
        }
      }
      const prev = new Int32Array(g);
      const next = new Int32Array(g);
      for (let i = 0; i < g; i++) {
        prev[i] = (i - 1 + g) % g;
        next[i] = (i + 1) % g;
      }
      let A2 = new Float32Array(size);
      let B2 = new Float32Array(size);
      for (let s = 0; s < steps; s++) {
        for (let y = 0; y < g; y++) {
          const row = y * g;
          const up = prev[y] * g;
          const down = next[y] * g;
          for (let x = 0; x < g; x++) {
            const i = row + x;
            const l = prev[x];
            const r = next[x];
            const la = A[row + l] + A[row + r] + A[up + x] + A[down + x]
              + (A[up + l] + A[up + r] + A[down + l] + A[down + r]) * 0.25 - A[i] * 5;
            const lb = B[row + l] + B[row + r] + B[up + x] + B[down + x]
              + (B[up + l] + B[up + r] + B[down + l] + B[down + r]) * 0.25 - B[i] * 5;
            const reacted = A[i] * B[i] * B[i];
            A2[i] = A[i] + (dA * la * 0.2 - reacted + feed * (1 - A[i]));
            B2[i] = B[i] + (dB * lb * 0.2 + reacted - (kill + feed) * B[i]);
          }
        }
        [A, A2] = [A2, A];
        [B, B2] = [B2, B];
      }
      const field = new Float32Array(size);
      for (let i = 0; i < size; i++) field[i] = clamp01((B[i] * 3.2 - 0.05) * (0.6 + gate * 0.7));
      paintField(ctx, w, h, field, g, g, tone);
      fold(ctx, w, h, mirror);
    },
  },

  attractor: {
    label: 'ATTRACTOR',
    desc: 'a million points falling into the same strange orbit',
    wild: 'rules',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, jitter, skew, hotRate, seedNum, mirror, a, b, c, d } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 3);
      const size = w * h;
      const counts = new Uint32Array(size);
      const points = Math.round(size * (0.4 + density * 1.1));
      const clifford = complexity > 0.5;
      const ca = -3 + a * 6;
      const cb = -3 + b * 6;
      const cc = -3 + c * 6;
      const cd = -3 + d * 6;
      const rot = skew * TAU;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const stepFor = (k1, k2, k3, k4) => (clifford
        ? (x, y) => [Math.sin(k1 * y) + k3 * Math.cos(k1 * x), Math.sin(k2 * x) + k4 * Math.cos(k2 * y)]
        : (x, y) => [Math.sin(k1 * y) - Math.cos(k2 * x), Math.sin(k3 * x) - Math.cos(k4 * y)]);
      // A clifford orbit reaches 1+|c| while a de jong one stays inside 2, and
      // plenty of constants collapse the orbit onto a single dot. Measure the
      // orbit before drawing it: fit what spreads, and fall back to constants
      // known to spread rather than hand back a black square.
      let step = stepFor(ca, cb, cc, cd);
      let spread = measureOrbit(step, cosR, sinR);
      if (!spread) {
        step = stepFor(...ATTRACTOR_FALLBACK);
        spread = measureOrbit(step, cosR, sinR);
      }
      const zoom = ATTRACTOR_FIT * Math.min(w, h) / spread.reach / (0.7 + scale * 0.3);
      const cx = w / 2 - spread.midX * zoom;
      const cy = h / 2 - spread.midY * zoom;
      let x = 0.1;
      let y = 0.1;
      let peak = 1;
      for (let i = 0; i < points; i++) {
        [x, y] = step(x, y);
        if (i < ATTRACTOR_WARMUP) continue;
        const jx = x + (rng() - 0.5) * jitter * 0.05;
        const jy = y + (rng() - 0.5) * jitter * 0.05;
        const px = Math.round(cx + (jx * cosR - jy * sinR) * zoom);
        const py = Math.round(cy + (jx * sinR + jy * cosR) * zoom);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const at = py * w + px;
        counts[at]++;
        if (counts[at] > peak) peak = counts[at];
      }
      const field = new Float32Array(size);
      const gain = 1 + hotRate * 40;
      const norm = 1 / Math.log(1 + peak * gain);
      for (let i = 0; i < size; i++) {
        if (counts[i]) field[i] = Math.log(1 + counts[i] * gain) * norm;
      }
      paintField(ctx, w, h, field, w, h, tone, false);
      fold(ctx, w, h, mirror);
    },
  },

  shards: {
    label: 'SHARDS',
    desc: 'the plane broken into plates, lit along the cracks',
    wild: 'rules',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, warp, bias, skew, gate, hotRate, seedNum, mirror, b } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 4);
      const metric = SHARD_METRICS[Math.min(2, Math.floor(((skew + 1) / 2) * 3))];
      const count = 12 + Math.round(density * 140);
      const cols = Math.max(2, Math.round(Math.sqrt(count)));
      const sx = new Float32Array(count);
      const sy = new Float32Array(count);
      const shade = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        // warp slides the sites from a lattice (regular plates) to pure scatter
        const gx = ((i % cols) + 0.5) / cols;
        const gy = (Math.floor(i / cols) + 0.5) / Math.ceil(count / cols);
        sx[i] = lerp(gx, rng(), clamp01(0.15 + warp)) * w;
        sy[i] = lerp(gy, rng(), clamp01(0.15 + warp)) * h;
        const roll = rng();
        shade[i] = roll < hotRate ? 1 : roll > gate ? 0 : 0.3 + roll * (0.4 + bias + 0.3);
      }
      const stretch = 0.5 + b * scale;
      const dist = (i, x, y) => metric(Math.abs(x - sx[i]), Math.abs(y - sy[i]) * stretch);
      const boxDist = (i, x0, y0, x1, y1, far) => {
        const dx0 = Math.abs(x0 - sx[i]);
        const dx1 = Math.abs(x1 - sx[i]);
        const dy0 = Math.abs(y0 - sy[i]) * stretch;
        const dy1 = Math.abs(y1 - sy[i]) * stretch;
        const inX = sx[i] >= x0 && sx[i] <= x1;
        const inY = sy[i] >= y0 && sy[i] <= y1;
        if (far) return metric(Math.max(dx0, dx1), Math.max(dy0, dy1));
        return metric(inX ? 0 : Math.min(dx0, dx1), inY ? 0 : Math.min(dy0, dy1));
      };
      const crack = 0.008 + complexity * 0.05;
      const field = new Float32Array(w * h);
      const candidates = [];
      for (let ty = 0; ty < h; ty += SHARD_TILE) {
        for (let tx = 0; tx < w; tx += SHARD_TILE) {
          const x1 = Math.min(w - 1, tx + SHARD_TILE - 1);
          const y1 = Math.min(h - 1, ty + SHARD_TILE - 1);
          let bound = Infinity;
          let second = Infinity;
          for (let i = 0; i < count; i++) {
            const far = boxDist(i, tx, ty, x1, y1, true);
            if (far < bound) { second = bound; bound = far; } else if (far < second) second = far;
          }
          candidates.length = 0;
          for (let i = 0; i < count; i++) {
            if (boxDist(i, tx, ty, x1, y1, false) <= second) candidates.push(i);
          }
          for (let y = ty; y <= y1; y++) {
            for (let x = tx; x <= x1; x++) {
              let f1 = Infinity;
              let f2 = Infinity;
              let id = 0;
              for (const i of candidates) {
                const d = dist(i, x, y);
                if (d < f1) { f2 = f1; f1 = d; id = i; } else if (d < f2) f2 = d;
              }
              const ratio = f2 ? f1 / f2 : 0;
              field[y * w + x] = ratio > 1 - crack ? 1 : shade[id] * (0.4 + (1 - ratio) * 0.75);
            }
          }
        }
      }
      paintField(ctx, w, h, field, w, h, tone, false);
      fold(ctx, w, h, mirror);
    },
  },

  packing: {
    label: 'PACKING',
    desc: 'circles crammed in until nothing else fits',
    wild: 'knobs',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, warp, jitter, gate, hotRate, decay, seedNum, mirror, a } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 5);
      const span = Math.min(w, h);
      ground(ctx, w, h);
      const minR = span * (0.002 + (1 - density) * 0.006);
      const maxR = span * (0.02 + complexity * 0.12) / Math.max(0.5, scale);
      const attempts = Math.round(4000 + density * 12000);
      const cell = maxR;
      const gw = Math.ceil(w / cell);
      const gh = Math.ceil(h / cell);
      const bins = Array.from({ length: gw * gh }, () => []);
      const circles = [];
      for (let i = 0; i < attempts; i++) {
        const x = rng() * w;
        const y = rng() * h;
        const bx = Math.floor(x / cell);
        const by = Math.floor(y / cell);
        let r = Math.min(maxR, x, y, w - x, h - y);
        for (let oy = -2; oy <= 2 && r >= minR; oy++) {
          for (let ox = -2; ox <= 2 && r >= minR; ox++) {
            const nx = bx + ox;
            const ny = by + oy;
            if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
            for (const c of bins[ny * gw + nx]) {
              const gapped = Math.hypot(x - c.x, y - c.y) - c.r - span * 0.001 * (1 + jitter * 4);
              if (gapped < r) r = gapped;
            }
          }
        }
        if (r < minR) continue;
        const circle = { x, y, r };
        circles.push(circle);
        bins[by * gw + bx].push(circle);
      }
      const squash = 1 - warp * 0.6;
      const turn = a * TAU;
      for (const c of circles) {
        const t = 0.3 + (1 - c.r / maxR) * 0.6;
        const solid = rng() < hotRate;
        if (rng() > gate) continue;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, c.r, c.r * squash, turn, 0, TAU);
        if (solid) {
          ctx.fillStyle = toneCss(tone, 1);
          ctx.fill();
          continue;
        }
        ctx.lineWidth = 1 + c.r * (0.05 + decay * 0.3);
        ctx.strokeStyle = toneCss(tone, t);
        ctx.stroke();
      }
      fold(ctx, w, h, mirror);
    },
  },

  growth: {
    label: 'GROWTH',
    desc: 'dust wandering in and sticking where it lands',
    wild: 'knobs',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, bias, skew, gate, drift, seedNum, mirror, a } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 6);
      const g = clamp(Math.round(Math.sqrt(w * h) / GROWTH_GRID_DIVISOR), 96, GROWTH_GRID_MAX);
      const grid = new Int32Array(g * g);
      const centre = g / 2;
      const nuclei = 1 + Math.floor(a * 4);
      let stuck = 0;
      // Walkers are born just outside the cluster and die not far beyond it, so
      // a nucleus scattered across the field is one no walker can ever reach:
      // seeds belong where the growth starts.
      for (let i = 0; i < nuclei; i++) {
        const nx = Math.round(centre + (rng() - 0.5) * g * GROWTH_NUCLEI_SPREAD);
        const ny = Math.round(centre + (rng() - 0.5) * g * GROWTH_NUCLEI_SPREAD);
        grid[ny * g + nx] = ++stuck;
      }
      const walkers = Math.round(g * g * (GROWTH_DUST_MIN + density * GROWTH_DUST_SPAN));
      const stickiness = 0.25 + gate * 0.75;
      // a hard wind sweeps every walker past the cluster and nothing sticks
      const windX = skew * GROWTH_WIND;
      const windY = bias * GROWTH_WIND * drift;
      const stepsCap = Math.round(GROWTH_STEPS_MIN + complexity * GROWTH_STEPS_SPAN);
      let reach = 6;
      const occupied = (x, y) => x >= 0 && y >= 0 && x < g && y < g && grid[y * g + x];
      for (let i = 0; i < walkers; i++) {
        const angle = rng() * TAU;
        const spawn = reach + 4;
        let x = Math.round(centre + Math.cos(angle) * spawn);
        let y = Math.round(centre + Math.sin(angle) * spawn);
        const kill = spawn * 2 + 12;
        for (let s = 0; s < stepsCap; s++) {
          x += Math.round(rng() * 2 - 1 + windX);
          y += Math.round(rng() * 2 - 1 + windY);
          const dx = x - centre;
          const dy = y - centre;
          if (Math.hypot(dx, dy) > kill) break;
          if (x <= 0 || y <= 0 || x >= g - 1 || y >= g - 1) break;
          const touching = occupied(x - 1, y) || occupied(x + 1, y) || occupied(x, y - 1) || occupied(x, y + 1);
          if (!touching || rng() > stickiness) continue;
          grid[y * g + x] = ++stuck;
          reach = Math.max(reach, Math.hypot(dx, dy));
          break;
        }
      }
      const field = new Float32Array(g * g);
      for (let i = 0; i < grid.length; i++) {
        if (grid[i]) field[i] = 0.35 + (grid[i] / stuck) * 0.65;
      }
      paintField(ctx, w, h, field, g, g, tone, false);
      fold(ctx, w, h, mirror);
    },
  },

  truchet: {
    label: 'TRUCHET',
    desc: 'tiles subdividing under themselves, each one turned at random',
    wild: 'knobs',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, warp, gate, hotRate, decay, seedNum, mirror } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 7);
      ground(ctx, w, h);
      ctx.lineCap = 'butt';
      const base = 2 + Math.round(scale * 3);
      const maxDepth = 1 + Math.round(complexity * 4);
      const splitChance = 0.15 + density * 0.65;
      const arcish = 1 - warp;
      const tile = (x, y, size, depth) => {
        if (depth < maxDepth && rng() < splitChance) {
          const half = size / 2;
          for (let i = 0; i < 4; i++) tile(x + (i % 2) * half, y + Math.floor(i / 2) * half, half, depth + 1);
          return;
        }
        if (rng() > gate) return;
        const flip = rng() < 0.5;
        const hot = rng() < hotRate;
        ctx.lineWidth = size * (0.05 + decay * 0.3);
        ctx.strokeStyle = toneCss(tone, hot ? 1 : 0.35 + (depth / maxDepth) * 0.5);
        ctx.beginPath();
        if (rng() < arcish) {
          const [ax, ay] = flip ? [x, y] : [x + size, y];
          const [bx, by] = flip ? [x + size, y + size] : [x, y + size];
          ctx.arc(ax, ay, size / 2, 0, TAU);
          ctx.arc(bx, by, size / 2, 0, TAU);
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, y, size, size);
          ctx.clip();
          ctx.beginPath();
          ctx.arc(ax, ay, size / 2, 0, TAU);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(bx, by, size / 2, 0, TAU);
          ctx.stroke();
          ctx.restore();
          return;
        }
        ctx.moveTo(flip ? x : x + size, y);
        ctx.lineTo(flip ? x + size : x, y + size);
        ctx.stroke();
      };
      const size = Math.max(w, h) / base;
      for (let y = 0; y < h; y += size) {
        for (let x = 0; x < w; x += size) tile(x, y, size, 0);
      }
      fold(ctx, w, h, mirror);
    },
  },

  interference: {
    label: 'INTERFERENCE',
    desc: 'point sources ringing straight through each other',
    wild: 'rules',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, warp, drift, jitter, bias, skew, gate, decay, seedNum, mirror, f } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 8);
      const count = 3 + Math.round(complexity * 9);
      const layout = EMITTER_LAYOUTS[Math.floor(clamp01(f) * EMITTER_LAYOUTS.length) % EMITTER_LAYOUTS.length];
      const emitters = [];
      for (let i = 0; i < count; i++) {
        emitters.push({
          ...layout(rng, w, h, i, count),
          phase: rng() * TAU * drift,
          plane: rng() < warp,
          angle: rng() * TAU,
        });
      }
      const freq = (0.08 + density * 0.22) * scale;
      const falloff = decay * 0.02;
      const bands = 2 + Math.round(gate * 12);
      const stretch = 1 + skew;
      const field = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (const em of emitters) {
            const dx = x - em.x;
            const dy = (y - em.y) * stretch;
            if (em.plane) {
              sum += Math.sin((dx * Math.cos(em.angle) + dy * Math.sin(em.angle)) * freq + em.phase);
              continue;
            }
            const d = Math.sqrt(dx * dx + dy * dy);
            sum += Math.sin(d * freq + em.phase) / (1 + d * falloff);
          }
          const v = clamp01(sum / count * 0.5 + 0.5 + bias
            + (hash2(x, y, seedNum) - 0.5) * jitter * 0.3);
          field[y * w + x] = Math.round(v * bands) / bands;
        }
      }
      paintField(ctx, w, h, field, w, h, tone, false);
      fold(ctx, w, h, mirror);
    },
  },

  feedback: {
    label: 'FEEDBACK',
    desc: 'the frame eating itself, a little zoomed and a little turned',
    wild: 'knobs',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, warp, drift, jitter, gate, hotRate, decay, churn, seedNum, mirror, a, b, c } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 9);
      const span = Math.min(w, h);
      ground(ctx, w, h);
      const passes = Math.round(30 + churn * 60);
      const zoom = 1.01 + a * 0.09 * scale;
      const turn = (b - 0.5) * 0.14 * drift;
      const slideX = (c - 0.5) * span * 0.02 * warp;
      const slideY = (rng() - 0.5) * span * 0.02 * warp;
      const marks = 1 + Math.round(density * 3);
      const cx = w / 2;
      const cy = h / 2;
      const stamp = () => {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < marks; i++) {
          const hot = rng() < hotRate + 0.08;
          ctx.fillStyle = toneCss(tone, hot ? 1 : 0.4 + rng() * 0.4);
          ctx.globalAlpha = 0.25 + gate * 0.5;
          const kind = rng();
          const size = span * (0.01 + rng() * 0.06 * (0.4 + complexity));
          const x = cx + (rng() - 0.5) * span * (0.1 + jitter);
          const y = cy + (rng() - 0.5) * span * (0.1 + jitter);
          if (kind < 0.4) {
            ctx.fillRect(x - size, y - size * 0.15, size * 2, size * 0.3);
            continue;
          }
          if (kind < 0.75) {
            ctx.beginPath();
            ctx.arc(x, y, size, 0, TAU);
            ctx.fill();
            continue;
          }
          ctx.fillRect(x - size * 0.15, y - size, size * 0.3, size * 2);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      };
      stamp();
      for (let i = 0; i < passes; i++) {
        ctx.save();
        ctx.translate(cx + slideX, cy + slideY);
        ctx.rotate(turn);
        ctx.scale(zoom, zoom);
        ctx.translate(-cx, -cy);
        ctx.globalAlpha = 1 - decay * 0.25;
        ctx.drawImage(ctx.canvas, 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
        stamp();
      }
      fold(ctx, w, h, mirror);
    },
  },

  escape: {
    label: 'ESCAPE',
    desc: 'a julia set counting how fast the numbers run away',
    wild: 'rules',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, warp, bias, skew, gate, hotRate, seedNum, mirror, a, b, c, d } = knobs(p);
      const tone = toneTable(palette);
      // c is walked around the boundary of the mandelbrot cardioid: inside it
      // the julia set is a fat blob, far outside it is dust, and only along the
      // edge does it come out dendritic
      const theta = a * TAU;
      // Inside the cardioid the julia set is a fat blob that fills the frame
      // with one tone; only within a hair of the boundary does it go dendritic.
      const edge = ESCAPE_EDGE_MIN + b * ESCAPE_EDGE_SPAN;
      const cr = (0.5 * Math.cos(theta) - 0.25 * Math.cos(2 * theta)) * edge;
      const ci = (0.5 * Math.sin(theta) - 0.25 * Math.sin(2 * theta)) * edge;
      const power = 2 + Math.floor(warp * 2.6);
      const maxIter = ESCAPE_MIN_ITER + Math.round(complexity * ESCAPE_ITER_SPAN);
      const zoom = 2.4 / (0.6 + scale * 0.7);
      const rot = skew * 1.5;
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const offX = (c - 0.5) * 0.6;
      const offY = (d - 0.5) * 0.6;
      const span = Math.min(w, h);
      const field = new Float32Array(w * h);
      const trapRadius = 0.1 + gate * 0.5;
      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const ux = ((px - w / 2) / span) * zoom + offX;
          const uy = ((py - h / 2) / span) * zoom + offY;
          let zr = ux * cosR - uy * sinR;
          let zi = ux * sinR + uy * cosR;
          let trap = 4;
          let n = 0;
          // the escape test already needs |z|², so the trap distance reuses it
          // rather than paying for a second hypot on every iteration
          let r2 = zr * zr + zi * zi;
          while (n < maxIter && r2 < 16) {
            let nr = zr;
            let ni = zi;
            for (let k = 1; k < power; k++) {
              const tr = nr * zr - ni * zi;
              ni = nr * zi + ni * zr;
              nr = tr;
            }
            zr = nr + cr;
            zi = ni + ci;
            r2 = zr * zr + zi * zi;
            const orbit = Math.abs(Math.sqrt(r2) - trapRadius);
            if (orbit < trap) trap = orbit;
            n++;
          }
          const escaped = n < maxIter;
          // bias used to be added to the whole field, which at chaos simply
          // lifted every pixel into the same tone and flattened the set into a
          // slab of colour. It bends the ramp instead.
          const v = escaped
            ? Math.pow(n / maxIter, clamp(ESCAPE_CURVE + hotRate + bias * ESCAPE_BIAS_BEND, ESCAPE_CURVE_MIN, ESCAPE_CURVE_MAX))
            : clamp01(ESCAPE_INTERIOR_FLOOR
              + (1 - Math.min(trap * (ESCAPE_TRAP_BASE + gate * ESCAPE_TRAP_SPAN), 1)) * (1 - ESCAPE_INTERIOR_FLOOR))
              * (0.5 + density * 0.5);
          field[py * w + px] = escaped ? v * 0.85 : v;
        }
      }
      paintField(ctx, w, h, field, w, h, tone, false);
      fold(ctx, w, h, mirror);
    },
  },

  bloom: {
    label: 'BLOOM',
    desc: 'an l-system growing until it runs out of room',
    wild: 'rules',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, warp, jitter, drift, gate, hotRate, decay, seedNum, mirror, a, b } = knobs(p);
      const tone = toneTable(palette);
      const rng = mulberry32(seedNum + 11);
      ground(ctx, w, h);
      const rule = LSYSTEM_RULES[Math.floor(clamp01(a) * LSYSTEM_RULES.length) % LSYSTEM_RULES.length];
      const depth = 3 + Math.round(complexity * 3);
      let word = 'F';
      for (let i = 0; i < depth; i++) {
        let grown = '';
        for (const ch of word) grown += ch === 'F' ? rule : ch;
        if (grown.length > LSYSTEM_LIMIT) break;
        word = grown;
      }
      const angle = (0.12 + b * 0.5) * (1 + warp);
      const segments = [];
      const stack = [];
      let x = 0;
      let y = 0;
      let heading = -Math.PI / 2;
      let level = 0;
      let maxLevel = 1;
      for (const ch of word) {
        if (ch === 'F') {
          const shrink = Math.pow(1 - decay * 0.15, level);
          const nx = x + Math.cos(heading) * shrink;
          const ny = y + Math.sin(heading) * shrink;
          segments.push([x, y, nx, ny, level]);
          x = nx;
          y = ny;
          continue;
        }
        if (ch === '+') { heading += angle * (1 + (rng() - 0.5) * jitter * 2) * drift; continue; }
        if (ch === '-') { heading -= angle * (1 + (rng() - 0.5) * jitter * 2) * drift; continue; }
        if (ch === '[') { stack.push([x, y, heading, level]); level++; maxLevel = Math.max(maxLevel, level); continue; }
        if (ch === ']') [x, y, heading, level] = stack.pop();
      }
      if (!segments.length) return;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [ax, ay, bx, by] of segments) {
        x0 = Math.min(x0, ax, bx);
        y0 = Math.min(y0, ay, by);
        x1 = Math.max(x1, ax, bx);
        y1 = Math.max(y1, ay, by);
      }
      const fit = 1 / Math.max(x1 - x0 || 1, y1 - y0 || 1);
      const paths = Array.from({ length: maxLevel + 1 }, () => new Path2D());
      const midX = (x0 + x1) / 2;
      const midY = (y0 + y1) / 2;
      for (const [ax, ay, bx, by, lv] of segments) {
        if (rng() > gate) continue;
        const path = paths[lv];
        path.moveTo((ax - midX) * fit, (ay - midY) * fit);
        path.lineTo((bx - midX) * fit, (by - midY) * fit);
      }
      const copies = 1 + Math.floor(density * 5);
      const span = Math.min(w, h) * (copies > 1 ? 0.44 : 0.92);
      ctx.lineCap = 'round';
      for (let i = 0; i < copies; i++) {
        ctx.save();
        ctx.translate(w / 2, h / 2);
        ctx.rotate((i / copies) * TAU);
        if (copies > 1) ctx.translate(0, -Math.min(w, h) * 0.24);
        ctx.scale(span, span);
        for (let lv = 0; lv <= maxLevel; lv++) {
          ctx.lineWidth = (0.02 - (lv / (maxLevel + 1)) * 0.016) / (1 + copies * 0.2);
          ctx.strokeStyle = toneCss(tone, lv >= maxLevel ? 0.75 + hotRate : 0.35 + (lv / (maxLevel + 1)) * 0.4);
          ctx.stroke(paths[lv]);
        }
        ctx.restore();
      }
      fold(ctx, w, h, mirror);
    },
  },

  contour: {
    label: 'CONTOUR',
    desc: 'noise read as terrain, then sliced into level lines',
    wild: 'rules',
    render: (ctx, w, h, p, palette) => {
      const { density, complexity, scale, warp, drift, jitter, bias, skew, gate, hotRate, seedNum, mirror, a, f } = knobs(p);
      const tone = toneTable(palette);
      const fieldAt = fieldKindFor(f);
      const span = Math.min(w, h);
      const freq = (2.5 + a * 5) * scale / span;
      const octaves = 3 + Math.round(complexity * 3);
      const bands = 5 + Math.round(gate * 24);
      const warpAmount = warp * span * 0.5 * drift;
      const thickness = 3 + (1 - density) * 14;
      const field = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = x + skew * (y - h / 2) * 0.3;
          let nx = sx * freq;
          let ny = y * freq;
          if (warpAmount) {
            nx += fbm(sx * freq * 0.5 + 4.2, y * freq * 0.5, seedNum + 71, 2) * warpAmount * freq;
            ny += fbm(sx * freq * 0.5, y * freq * 0.5 + 1.7, seedNum + 97, 2) * warpAmount * freq;
          }
          // Jitter belongs in the terrain, not in its height: shaking the value
          // moves a pixel more than a whole contour band and dissolves the
          // lines into speckle. Shaking where we sample only roughens them.
          nx += (hash2(x, y, seedNum) - 0.5) * jitter * CONTOUR_JITTER;
          ny += (hash2(x, y, seedNum + 5) - 0.5) * jitter * CONTOUR_JITTER;
          const v = clamp01(fieldAt(nx, ny, seedNum, octaves) + bias);
          const rung = Math.abs(frac(v * bands + 0.5) - 0.5) * 2;
          const line = clamp01(1 - rung * thickness);
          const wash = v * CONTOUR_WASH;
          field[y * w + x] = Math.max(wash, line * (v > 1 - hotRate * 2 ? 1 : 0.55 + v * 0.35));
        }
      }
      paintField(ctx, w, h, field, w, h, tone, false);
      fold(ctx, w, h, mirror);
    },
  },
};
