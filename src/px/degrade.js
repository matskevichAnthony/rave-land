// Destructive operators for the picture apparatus. Every one is pure —
// (imageData, p, amount) always yields the same pixels, so a seed and a slider
// fully describe the damage — and every one returns a NEW ImageData, leaving
// the caller's frame untouched.
//
// p comes from machine/chaos.js (see RANGES there for every knob and its
// range); operators read the wide knobs defensively, so a bare { a, b, c }
// still bites. amount is 0 (near-no-op) to 1 (ruined).
//
// The map's order is the chain order: the page applies the enabled operators
// top to bottom, so they read as a signal path — geometry, then colour, then
// the codec, then the raw buffer, then decay.
//
// An operator may declare `options`: named choices the page shows as chips and
// hands back through apply's fourth argument. Every option has an `initial`,
// and apply reads defensively, so a bare three-argument call still works.

import { mulberry32 } from './rng.js';

const TAU = Math.PI * 2;
const CHANNELS = 4;
const ALPHA = 3;
const OPAQUE = 255;
const FULL_SCALE = 255;

// patterns.js hashes with sin, but these operators run the hash once per pixel
// at 1024x1024, where the integer mix is the same shape and an order faster.
const hash = (a, b) => {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const wrap = (x, n) => ((x % n) + n) % n;
const lumaAt = (d, i) => (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8;
const copyOf = img => new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);

const WARP_BASE_AMP = 0.015;
const WARP_KNOB_AMP = 0.09;
const WARP_MIN_CYCLES = 1.5;
const WARP_CYCLE_SPAN = 6;

const SKEW_MAX_REACH = 0.05;
const SKEW_SHEAR = 0.12;

const STRETCH_MIN_CONTROLS = 3;
const STRETCH_CONTROL_SPAN = 9;
const STRETCH_MAX_PULL = 6;
// smoothed noise crowds around zero, which reads as a faint squash rather than
// taffy; pushing it back toward its extremes is what makes regions genuinely
// balloon and crush
const STRETCH_SHAPE = 0.55;
const STRETCH_BAND_SCALE = { wide: 0.5, mid: 1, narrow: 2.2 };

const LENS_MIN_COUNT = 2;
const LENS_COUNT_SPAN = 4;
const LENS_MIN_RADIUS = 0.18;
const LENS_RADIUS_SPAN = 0.32;
const LENS_MAX_POWER = 2.6;
const LENS_MIN_ZOOM = 0.3;
const LENS_FEW = 2;
const LENS_MANY = 8;

const SELF_CELL = 8;
const SELF_BLUR_PASSES = 2;
const SELF_MAX_REACH = 0.15;
const SELF_EDGE_GAIN = 6;
const SELF_TWIST = 0.9;

const MOSH_BLOCK_MIN = 18;
const MOSH_BLOCK_SPAN = 38;
const MOSH_ODDS = 0.55;
const MOSH_SMEAR_ODDS = 0.35;
const MOSH_MAX_SHIFT = 0.22;
const MOSH_BLOCK_SMALL = 14;
const MOSH_BLOCK_BIG = 72;

const WEAVE_STRIP_MIN = 10;
const WEAVE_STRIP_SPAN = 44;
const WEAVE_MAX_THROW = 0.28;

const SLICE_MIN_BANDS = 5;
const SLICE_BAND_SPAN = 55;
const SLICE_BASE_REACH = 0.15;
const SLICE_DECAY_REACH = 0.85;
const SLICE_MIN_HEIGHT = 0.3;
const SLICE_HEIGHT_SPAN = 1.7;

const SORT_CENTRE = 128;
const SORT_BIAS_SWING = 200;
const SORT_MAX_BAND = 150;
const PACK_RANGE = 0x100000000;

const QUANT_MAX_LEVELS = 256;
const QUANT_MIN_LEVELS = 2;
const QUANT_CURVE = 2.5;
const QUANT_CHANNEL_SPREAD = 0.8;
const QUANT_DITHER_BASE = 0.4;
const QUANT_DITHER_SPAN = 1.1;
const QUANT_BIAS_LIFT = 40;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => v / 16);
const BAYER_SIDE = 3;

const JPEG_QUALITY_CLEAN = 0.95;
const JPEG_QUALITY_RUINED = 0.26;
const BEND_MAX_HITS = 260;
const BEND_CHURN_BASE = 0.3;
const BEND_CHURN_SPAN = 1.7;
const BEND_MAX_BURST = 5;
// the first bytes of the scan set the DC baseline every later block leans on;
// hit them and the whole frame slides to one colour instead of glitching
const BEND_HEAD_GUARD = 96;
const BEND_TAIL_GUARD = 16;
const BEND_RETRIES = 4;
const BEND_BLANK_LUMA = 6;
const MARKER_PREFIX = 0xff;
const MARKER_SOS = 0xda;
const SOI_LENGTH = 2;

const AMP_SAMPLE_RATE = 44100;
const AMP_HALF_SCALE = 127.5;
const AMP_MAX_DELAY_SECONDS = 2;
const AMP_IR_SEED = 0x77aa;
const AMP_VERB_IR_MIN = 0.05;
const AMP_VERB_IR_SPAN = 0.3;
const AMP_VERB_DECAY = 2.2;
const AMP_VERB_WET = 1.4;
const AMP_VERB_DRY_CUT = 0.7;
const AMP_DIST_DRIVE = 26;
const AMP_DIST_CURVE_SAMPLES = 1024;
const AMP_DIST_RING_GAIN_DB = 15;
const AMP_DIST_RING_Q = 9;
const AMP_RING_PERIOD_MIN = 4;
const AMP_RING_PERIOD_SPAN = 22;
const AMP_COMB_FRAC_MIN = 0.04;
const AMP_COMB_FRAC_SPAN = 0.18;
const AMP_COMB_FEEDBACK = 0.82;
const AMP_ECHO_ROWS_MIN = 6;
const AMP_ECHO_ROWS_SPAN = 30;
const AMP_ECHO_LEAN = 0.5;
const AMP_ECHO_FEEDBACK = 0.7;

const BYTE_MAX_RUNS = 48;
const BYTE_CHURN_BASE = 0.3;
const BYTE_CHURN_SPAN = 1.7;
const BYTE_MIN_RUN = 64;
const BYTE_RUN_FRACTION = 0.05;
const BYTE_MAX_SHIFT = 4096;

const SCAN_BASE_ODDS = 0.25;
const SCAN_DECAY_ODDS = 0.85;
const SCAN_MAX_ODDS = 0.92;
const SCAN_MAX_RUN = 24;
const SCAN_RUN_BASE = 0.5;

const ROT_MAX_NUCLEI = 5;
const ROT_CURVE = 1.7;
const ROT_MAX_REACH = 0.34;
const ROT_MIN_REACH = 1;
const ROT_BASE_BITE = 0.45;
const ROT_BITE_SPAN = 0.55;
const ROT_EDGE = 3;
const ROT_JITTER = 12;

const encodeJpeg = async (img, quality) => {
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d').putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
  return new Uint8Array(await blob.arrayBuffer());
};

// Walks the marker segments rather than searching for FF DA, which also occurs
// inside quantisation tables and would point the corruption at the header.
const findScanStart = bytes => {
  let i = SOI_LENGTH;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== MARKER_PREFIX) return -1;
    const marker = bytes[i + 1];
    if (marker === MARKER_PREFIX) { i++; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === MARKER_SOS) return i + SOI_LENGTH + length;
    i += SOI_LENGTH + length;
  }
  return -1;
};

const bendScan = (bytes, from, hits, burstMax, seed) => {
  const out = bytes.slice();
  const span = out.length - BEND_TAIL_GUARD - from;
  if (span <= 0) return out;
  for (let k = 0; k < hits; k++) {
    const at = from + Math.floor(hash(k, seed) * span);
    const burst = 1 + Math.floor(hash(k, seed + 1) * burstMax);
    for (let n = 0; n < burst; n++) {
      const i = at + n;
      if (i >= out.length - BEND_TAIL_GUARD) break;
      // FF opens a marker and must keep its stuffed 00; touch either and the
      // decoder abandons the scan instead of dragging through it
      if (out[i] === MARKER_PREFIX || out[i - 1] === MARKER_PREFIX) continue;
      out[i] = Math.floor(hash(k * burstMax + n, seed + 2) * MARKER_PREFIX);
    }
  }
  return out;
};

const meanLuma = img => {
  const d = img.data;
  let sum = 0;
  for (let i = 0; i < d.length; i += CHANNELS) sum += lumaAt(d, i);
  return sum / (d.length / CHANNELS);
};

const decodeJpeg = async (bytes, width, height) => {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return ctx.getImageData(0, 0, width, height);
};

// A monotonic dst→src map: where the advance runs slow the picture magnifies,
// where it runs fast it crushes — stretch and squeeze in different places,
// without ever tearing. Exact identity at amount 0.
function taffyMap(length, seed, amount, controls) {
  const pos = new Float32Array(length);
  for (let i = 1; i < length; i++) {
    const t = ((i - 1) / length) * controls;
    const k = Math.floor(t);
    const f = t - k;
    const smooth = f * f * (3 - 2 * f);
    const noise = lerp(hash(k, seed), hash(k + 1, seed), smooth) * 2 - 1;
    const shaped = Math.sign(noise) * Math.pow(Math.abs(noise), STRETCH_SHAPE);
    pos[i] = pos[i - 1] + Math.pow(STRETCH_MAX_PULL, shaped * amount);
  }
  const map = new Int32Array(length);
  const scale = (length - 1) / (pos[length - 1] || 1);
  for (let i = 0; i < length; i++) map[i] = Math.round(pos[i] * scale);
  return map;
}

// The displacement source for `self` is a coarse blurred luma grid, not
// per-pixel luma — sampled bilinearly it stays smooth, so the picture flows
// instead of dissolving into noise.
function lumaGrid(img, cell) {
  const { width: w, height: h, data: d } = img;
  const gw = Math.max(2, Math.ceil(w / cell));
  const gh = Math.max(2, Math.ceil(h / cell));
  const sums = new Float32Array(gw * gh);
  const counts = new Uint32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const row = Math.min(gh - 1, (y / cell) | 0) * gw;
    for (let x = 0; x < w; x++) {
      const g = row + Math.min(gw - 1, (x / cell) | 0);
      sums[g] += lumaAt(d, (y * w + x) * CHANNELS);
      counts[g]++;
    }
  }
  for (let g = 0; g < sums.length; g++) sums[g] /= (counts[g] || 1) * FULL_SCALE;
  return { grid: blurGrid(sums, gw, gh, SELF_BLUR_PASSES), gw, gh };
}

function blurGrid(grid, gw, gh, passes) {
  let cur = grid;
  let next = new Float32Array(grid.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const row = clamp(y + dy, 0, gh - 1) * gw;
          for (let dx = -1; dx <= 1; dx++) sum += cur[row + clamp(x + dx, 0, gw - 1)];
        }
        next[y * gw + x] = sum / 9;
      }
    }
    [cur, next] = [next, cur];
  }
  return cur;
}

function gradientGrids(grid, gw, gh) {
  const gx = new Float32Array(grid.length);
  const gy = new Float32Array(grid.length);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const g = y * gw + x;
      gx[g] = (grid[y * gw + clamp(x + 1, 0, gw - 1)] - grid[y * gw + clamp(x - 1, 0, gw - 1)]) / 2;
      gy[g] = (grid[clamp(y + 1, 0, gh - 1) * gw + x] - grid[clamp(y - 1, 0, gh - 1) * gw + x]) / 2;
    }
  }
  return { gx, gy };
}

const bilinear = (grid, gw, gh, u, v) => {
  const x = clamp(u, 0, gw - 1.001);
  const y = clamp(v, 0, gh - 1.001);
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const top = lerp(grid[y0 * gw + x0], grid[y0 * gw + x0 + 1], fx);
  const bottom = lerp(grid[(y0 + 1) * gw + x0], grid[(y0 + 1) * gw + x0 + 1], fx);
  return lerp(top, bottom, fy);
};

// Seeded noise impulse for the amp's convolver — the same mulberry32 idiom as
// vocal/engine.js, so the smear is identical on every run of the same seed.
function ampImpulse(ctx, seconds, seed) {
  const frames = Math.max(1, Math.ceil(seconds * ctx.sampleRate));
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const rng = mulberry32(seed);
  for (let i = 0; i < frames; i++) {
    data[i] = (rng() * 2 - 1) * Math.pow(1 - i / frames, AMP_VERB_DECAY);
  }
  return buffer;
}

function ampDriveCurve(drive) {
  const curve = new Float32Array(AMP_DIST_CURVE_SAMPLES);
  const max = Math.tanh(drive);
  for (let i = 0; i < AMP_DIST_CURVE_SAMPLES; i++) {
    const x = (i / (AMP_DIST_CURVE_SAMPLES - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / max;
  }
  return curve;
}

// Each rig is a small WebAudio graph the pixel signal is pushed through;
// `line` is one row (or column) in samples, so delays land as whole-pixel
// offsets. amount maps to wet, drive or feedback — 0 never reaches here.
const AMP_RIGS = {
  verb: (ctx, p, amount, line, seed) => {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = ampImpulse(ctx, AMP_VERB_IR_MIN + amount * AMP_VERB_IR_SPAN, seed);
    const dry = ctx.createGain();
    dry.gain.value = 1 - amount * AMP_VERB_DRY_CUT;
    const wet = ctx.createGain();
    wet.gain.value = amount * AMP_VERB_WET;
    input.connect(dry).connect(output);
    input.connect(convolver).connect(wet).connect(output);
    return { input, output };
  },
  dist: (ctx, p, amount) => {
    const ring = ctx.createBiquadFilter();
    ring.type = 'peaking';
    ring.Q.value = AMP_DIST_RING_Q;
    const period = AMP_RING_PERIOD_MIN + (p.c ?? 0.5) * AMP_RING_PERIOD_SPAN;
    ring.frequency.value = ctx.sampleRate / period;
    ring.gain.value = amount * AMP_DIST_RING_GAIN_DB;
    const shaper = ctx.createWaveShaper();
    shaper.curve = ampDriveCurve(1 + amount * amount * AMP_DIST_DRIVE);
    ring.connect(shaper);
    return { input: ring, output: shaper };
  },
  comb: (ctx, p, amount, line) => {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(AMP_MAX_DELAY_SECONDS);
    delay.delayTime.value = line * (AMP_COMB_FRAC_MIN + (p.a ?? 0.5) * AMP_COMB_FRAC_SPAN) / ctx.sampleRate;
    const feedback = ctx.createGain();
    feedback.gain.value = amount * AMP_COMB_FEEDBACK;
    const wet = ctx.createGain();
    wet.gain.value = amount;
    input.connect(output);
    input.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(output);
    return { input, output };
  },
  echo: (ctx, p, amount, line) => {
    const input = ctx.createGain();
    const output = ctx.createGain();
    const delay = ctx.createDelay(AMP_MAX_DELAY_SECONDS);
    const rows = Math.round(AMP_ECHO_ROWS_MIN + (p.b ?? 0.5) * AMP_ECHO_ROWS_SPAN);
    const lean = (p.f ?? 0.5) * AMP_ECHO_LEAN;
    delay.delayTime.value = line * (rows + lean) / ctx.sampleRate;
    const feedback = ctx.createGain();
    feedback.gain.value = amount * AMP_ECHO_FEEDBACK;
    const wet = ctx.createGain();
    wet.gain.value = amount;
    input.connect(output);
    input.connect(delay);
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(output);
    return { input, output };
  },
};

async function ampRender(samples, rig, p, amount, line, seed) {
  const ctx = new OfflineAudioContext(1, samples.length, AMP_SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, samples.length, AMP_SAMPLE_RATE);
  buffer.copyToChannel(samples, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const { input, output } = rig(ctx, p, amount, line, seed);
  src.connect(input);
  output.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

const sortRun = (d, base, step, from, to, descending, buf) => {
  buf.length = 0;
  for (let k = from; k < to; k++) {
    const i = (base + k * step) * CHANNELS;
    const packed = ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
    buf.push(lumaAt(d, i) * PACK_RANGE + packed);
  }
  buf.sort((x, y) => x - y);
  for (let k = 0; k < buf.length; k++) {
    const packed = (descending ? buf[buf.length - 1 - k] : buf[k]) % PACK_RANGE;
    const i = (base + (from + k) * step) * CHANNELS;
    d[i] = packed >>> 24;
    d[i + 1] = (packed >>> 16) & OPAQUE;
    d[i + 2] = (packed >>> 8) & OPAQUE;
    d[i + 3] = packed & OPAQUE;
  }
};

export const DEGRADES = {
  warp: {
    label: 'WARP',
    desc: 'the picture dragged through a standing wave',
    options: {
      axis: { label: 'AXIS', choices: { both: 'BOTH', x: 'ACROSS', y: 'DOWN' }, initial: 'both' },
    },
    apply: async (img, p, amount, opts = {}) => {
      const axis = opts.axis ?? 'both';
      const { width: w, height: h, data: src } = img;
      const out = new ImageData(w, h);
      const dst = out.data;
      const amp = amount * (WARP_BASE_AMP + (p.warp ?? 0.3) * WARP_KNOB_AMP) * Math.min(w, h);
      const cyclesY = (WARP_MIN_CYCLES + (p.a ?? 0.5) * WARP_CYCLE_SPAN) * (p.scale ?? 1);
      const cyclesX = (WARP_MIN_CYCLES + (p.b ?? 0.5) * WARP_CYCLE_SPAN) * (p.scale ?? 1);
      const phase = (p.c ?? 0) * TAU;
      const drift = p.drift ?? 1;
      const downBy = new Float32Array(w);
      if (axis !== 'x') {
        for (let x = 0; x < w; x++) downBy[x] = Math.sin((x / w) * cyclesX * TAU - phase) * amp * drift;
      }
      for (let y = 0; y < h; y++) {
        const acrossBy = axis === 'y' ? 0 : Math.sin((y / h) * cyclesY * TAU + phase) * amp;
        for (let x = 0; x < w; x++) {
          const sx = clamp(Math.round(x + acrossBy), 0, w - 1);
          const sy = clamp(Math.round(y + downBy[x]), 0, h - 1);
          const s = (sy * w + sx) * CHANNELS;
          const d = (y * w + x) * CHANNELS;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
      return out;
    },
  },

  skew: {
    label: 'SKEW',
    desc: 'the colour channels pulled off each other',
    apply: async (img, p, amount) => {
      const { width: w, height: h, data: src } = img;
      const out = new ImageData(w, h);
      const dst = out.data;
      const reach = amount * SKEW_MAX_REACH * Math.min(w, h);
      const across = [p.a ?? 0.5, p.b ?? 0.5, p.c ?? 0.5].map(v => (v - 0.5) * 2 * reach);
      const down = [p.d ?? 0.5, p.e ?? 0.5, p.f ?? 0.5].map(v => (v - 0.5) * 2 * reach);
      const shear = (p.skew ?? 0) * amount * SKEW_SHEAR;
      for (let y = 0; y < h; y++) {
        const lean = shear * (y - h / 2);
        for (let x = 0; x < w; x++) {
          const d = (y * w + x) * CHANNELS;
          for (let ch = 0; ch < ALPHA; ch++) {
            const sx = wrap(Math.round(x + across[ch] + lean), w);
            const sy = wrap(Math.round(y + down[ch]), h);
            dst[d + ch] = src[(sy * w + sx) * CHANNELS + ch];
          }
          dst[d + ALPHA] = src[d + ALPHA];
        }
      }
      return out;
    },
  },

  stretch: {
    label: 'STRETCH',
    desc: 'the picture pulled like taffy — magnified here, crushed there',
    options: {
      axis: { label: 'AXIS', choices: { both: 'BOTH', x: 'ACROSS', y: 'DOWN' }, initial: 'both' },
      bands: { label: 'BANDS', choices: { wide: 'WIDE', mid: 'MID', narrow: 'NARROW' }, initial: 'mid' },
    },
    apply: async (img, p, amount, opts = {}) => {
      const { width: w, height: h, data: src } = img;
      const out = new ImageData(w, h);
      const dst = out.data;
      const seed = p.seedNum ?? 0;
      const axis = opts.axis ?? 'both';
      const bands = STRETCH_BAND_SCALE[opts.bands ?? 'mid'];
      const controls = Math.max(2,
        Math.round((STRETCH_MIN_CONTROLS + (p.churn ?? 0.3) * STRETCH_CONTROL_SPAN) * bands));
      const mapX = axis === 'y' ? null : taffyMap(w, seed + 101, amount, controls);
      const mapY = axis === 'x' ? null : taffyMap(h, seed + 202, amount, controls);
      for (let y = 0; y < h; y++) {
        const srcRow = (mapY ? mapY[y] : y) * w;
        for (let x = 0; x < w; x++) {
          const s = (srcRow + (mapX ? mapX[x] : x)) * CHANNELS;
          const d = (y * w + x) * CHANNELS;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
      return out;
    },
  },

  lens: {
    label: 'LENS',
    desc: 'bulges and pinches pressed into the picture at seeded points',
    options: {
      kind: { label: 'KIND', choices: { mix: 'MIX', bulge: 'BULGE', pinch: 'PINCH' }, initial: 'mix' },
      count: { label: 'COUNT', choices: { auto: 'AUTO', few: 'FEW', many: 'MANY' }, initial: 'auto' },
    },
    apply: async (img, p, amount, opts = {}) => {
      const kind = opts.kind ?? 'mix';
      const { width: w, height: h, data: src } = img;
      const out = new ImageData(w, h);
      const dst = out.data;
      const seed = p.seedNum ?? 0;
      const count = opts.count === 'few' ? LENS_FEW
        : opts.count === 'many' ? LENS_MANY
        : LENS_MIN_COUNT + Math.round((p.churn ?? 0.3) * LENS_COUNT_SPAN);
      const span = Math.min(w, h);
      const lenses = [];
      for (let i = 0; i < count; i++) {
        const raw = hash(i, seed + 51) * 2 - 1;
        const signed = kind === 'bulge' ? Math.abs(raw) : kind === 'pinch' ? -Math.abs(raw) : raw;
        lenses.push({
          x: hash(i, seed + 11) * w,
          y: hash(i, seed + 23) * h,
          r: (LENS_MIN_RADIUS + hash(i, seed + 37) * LENS_RADIUS_SPAN) * span,
          power: signed * LENS_MAX_POWER * amount,
        });
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sx = x;
          let sy = y;
          for (const lens of lenses) {
            const dx = sx - lens.x;
            const dy = sy - lens.y;
            const d2 = (dx * dx + dy * dy) / (lens.r * lens.r);
            if (d2 >= 1) continue;
            const swell = 1 - d2;
            const zoom = Math.max(LENS_MIN_ZOOM, 1 + lens.power * swell * swell);
            sx = lens.x + dx / zoom;
            sy = lens.y + dy / zoom;
          }
          const s = (clamp(Math.round(sy), 0, h - 1) * w + clamp(Math.round(sx), 0, w - 1)) * CHANNELS;
          const d = (y * w + x) * CHANNELS;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
      return out;
    },
  },

  self: {
    label: 'SELF',
    desc: 'the picture displaced by its own light — content as its own current',
    options: {
      map: { label: 'MAP', choices: { luma: 'LUMA', edge: 'EDGE' }, initial: 'luma' },
      flow: { label: 'FLOW', choices: { grad: 'GRAD', angle: 'ANGLE', radial: 'RADIAL' }, initial: 'grad' },
    },
    apply: async (img, p, amount, opts = {}) => {
      const { width: w, height: h, data: src } = img;
      const out = new ImageData(w, h);
      const dst = out.data;
      const seed = p.seedNum ?? 0;
      const edge = (opts.map ?? 'luma') === 'edge';
      const flow = opts.flow ?? 'grad';
      const { grid, gw, gh } = lumaGrid(img, SELF_CELL);
      const { gx, gy } = gradientGrids(grid, gw, gh);
      const reach = amount * SELF_MAX_REACH * Math.min(w, h);
      // the seed twists every flow off its natural direction, so the same
      // picture bleeds differently on every roll
      const twist = ((hash(0, seed + 419) * 2 - 1) + (p.skew ?? 0)) * SELF_TWIST;
      const cosT = Math.cos(twist);
      const sinT = Math.sin(twist);
      const theta = (p.d ?? 0.5) * TAU + hash(1, seed + 419) * TAU;
      const angleX = Math.cos(theta);
      const angleY = Math.sin(theta);
      const cx = hash(2, seed + 419) * w;
      const cy = hash(3, seed + 419) * h;
      for (let y = 0; y < h; y++) {
        const v = y / SELF_CELL;
        for (let x = 0; x < w; x++) {
          const u = x / SELF_CELL;
          const slopeX = bilinear(gx, gw, gh, u, v);
          const slopeY = bilinear(gy, gw, gh, u, v);
          const magnitude = edge
            ? Math.min(1, Math.sqrt(slopeX * slopeX + slopeY * slopeY) * SELF_EDGE_GAIN)
            : bilinear(grid, gw, gh, u, v);
          let dirX = angleX;
          let dirY = angleY;
          if (flow === 'grad') {
            const len = Math.sqrt(slopeX * slopeX + slopeY * slopeY);
            dirX = len ? slopeX / len : 0;
            dirY = len ? slopeY / len : 0;
          } else if (flow === 'radial') {
            const rx = x - cx;
            const ry = y - cy;
            const len = Math.sqrt(rx * rx + ry * ry);
            dirX = len ? rx / len : 0;
            dirY = len ? ry / len : 0;
          }
          const push = magnitude * reach;
          const sx = clamp(Math.round(x - (dirX * cosT - dirY * sinT) * push), 0, w - 1);
          const sy = clamp(Math.round(y - (dirX * sinT + dirY * cosT) * push), 0, h - 1);
          const s = (sy * w + sx) * CHANNELS;
          const d = (y * w + x) * CHANNELS;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
      return out;
    },
  },

  slice: {
    label: 'SLICE',
    desc: 'bands of the picture ripped out of line',
    options: {
      axis: { label: 'AXIS', choices: { x: 'ACROSS', y: 'DOWN' }, initial: 'x' },
    },
    apply: async (img, p, amount, opts = {}) => {
      const { width: w, height: h, data: src } = img;
      const out = new ImageData(w, h);
      const dst = out.data;
      const seed = p.seedNum ?? 0;
      const down = (opts.axis ?? 'x') === 'y';
      const along = down ? h : w;
      const acrossSpan = down ? w : h;
      const bands = Math.round(SLICE_MIN_BANDS + (p.churn ?? 0.3) * SLICE_BAND_SPAN);
      const reach = along * amount * (SLICE_BASE_REACH + (p.decay ?? 0.3) * SLICE_DECAY_REACH);
      const offsets = new Int32Array(acrossSpan);
      let at = 0;
      for (let b = 0; at < acrossSpan; b++) {
        const thick = Math.max(1,
          Math.round((acrossSpan / bands) * (SLICE_MIN_HEIGHT + hash(b, seed) * SLICE_HEIGHT_SPAN)));
        // cubed, so most bands barely stir and a few are thrown right across
        const t = hash(b, seed + 1) * 2 - 1;
        const offset = Math.round(t * t * t * reach);
        for (let i = 0; i < thick && at < acrossSpan; i++, at++) offsets[at] = offset;
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const d = (y * w + x) * CHANNELS;
          const s = down
            ? (wrap(y + offsets[x], h) * w + x) * CHANNELS
            : (y * w + wrap(x + offsets[y], w)) * CHANNELS;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
      return out;
    },
  },

  mosh: {
    label: 'MOSH',
    desc: 'blocks torn loose and dragged, like video missing its keyframe',
    options: {
      kind: { label: 'KIND', choices: { mix: 'MIX', shift: 'SHIFT', smear: 'SMEAR' }, initial: 'mix' },
      block: { label: 'BLOCK', choices: { auto: 'AUTO', small: 'SMALL', big: 'BIG' }, initial: 'auto' },
    },
    apply: async (img, p, amount, opts = {}) => {
      const kind = opts.kind ?? 'mix';
      const out = copyOf(img);
      const { width: w, height: h } = img;
      const src = img.data;
      const d = out.data;
      const seed = p.seedNum ?? 0;
      const block = opts.block === 'small' ? MOSH_BLOCK_SMALL
        : opts.block === 'big' ? MOSH_BLOCK_BIG
        : Math.round(MOSH_BLOCK_MIN + (p.a ?? 0.5) * MOSH_BLOCK_SPAN);
      const reach = MOSH_MAX_SHIFT * Math.min(w, h) * amount;
      for (let by = 0; by < h; by += block) {
        for (let bx = 0; bx < w; bx += block) {
          const cell = bx * 7919 + by;
          if (hash(cell, seed) >= amount * MOSH_ODDS) continue;
          const smear = kind === 'smear' || (kind === 'mix' && hash(cell, seed + 3) < MOSH_SMEAR_ODDS);
          const dx = Math.round((hash(cell, seed + 7) - 0.5) * 2 * reach);
          const dy = Math.round((hash(cell, seed + 13) - 0.5) * 2 * reach);
          for (let y = by; y < Math.min(by + block, h); y++) {
            // a smeared block holds its first row all the way down — the drag
            // of a motion vector applied to a frame that never arrived
            const sy = smear ? by : clamp(y + dy, 0, h - 1);
            for (let x = bx; x < Math.min(bx + block, w); x++) {
              const sx = smear ? x : clamp(x + dx, 0, w - 1);
              const di = (y * w + x) * CHANNELS;
              const si = (sy * w + sx) * CHANNELS;
              d[di] = src[si];
              d[di + 1] = src[si + 1];
              d[di + 2] = src[si + 2];
            }
          }
        }
      }
      return out;
    },
  },

  weave: {
    label: 'WEAVE',
    desc: 'strips of the picture sliding against each other, rewoven',
    options: {
      axis: { label: 'AXIS', choices: { both: 'BOTH', x: 'ACROSS', y: 'DOWN' }, initial: 'both' },
    },
    apply: async (img, p, amount, opts = {}) => {
      const axis = opts.axis ?? 'both';
      const { width: w, height: h, data: src } = img;
      const out = new ImageData(w, h);
      const dst = out.data;
      const seed = p.seedNum ?? 0;
      const strip = Math.round(WEAVE_STRIP_MIN + (p.b ?? 0.5) * WEAVE_STRIP_SPAN);
      const throwX = amount * WEAVE_MAX_THROW * w;
      const throwY = amount * WEAVE_MAX_THROW * h;
      const rowShift = new Int32Array(Math.ceil(h / strip));
      const colShift = new Int32Array(Math.ceil(w / strip));
      if (axis !== 'y') {
        for (let i = 0; i < rowShift.length; i++) {
          rowShift[i] = Math.round(hash(i, seed + 71) * throwX) * (i % 2 ? 1 : -1);
        }
      }
      if (axis !== 'x') {
        for (let i = 0; i < colShift.length; i++) {
          colShift[i] = Math.round(hash(i, seed + 89) * throwY) * (i % 2 ? -1 : 1);
        }
      }
      for (let y = 0; y < h; y++) {
        const across = rowShift[Math.floor(y / strip)];
        for (let x = 0; x < w; x++) {
          const sx = wrap(x + across, w);
          const sy = wrap(y + colShift[Math.floor(sx / strip)], h);
          const s = (sy * w + sx) * CHANNELS;
          const d = (y * w + x) * CHANNELS;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
      return out;
    },
  },

  sort: {
    label: 'SORT',
    desc: 'runs of pixels reordered by brightness',
    options: {
      axis: { label: 'AXIS', choices: { auto: 'AUTO', x: 'ACROSS', y: 'DOWN' }, initial: 'auto' },
      order: { label: 'ORDER', choices: { auto: 'AUTO', light: 'LIGHT', dark: 'DARK' }, initial: 'auto' },
    },
    apply: async (img, p, amount, opts = {}) => {
      const out = copyOf(img);
      const { width: w, height: h } = img;
      const d = out.data;
      const seed = p.seedNum ?? 0;
      const vertical = opts.axis === 'y' || (opts.axis !== 'x' && (p.b ?? 0.5) > 0.5);
      const descending = opts.order === 'light' || (opts.order !== 'dark' && (p.skew ?? 0) < 0);
      const gate = p.gate ?? 1;
      const centre = SORT_CENTRE + (p.bias ?? 0) * SORT_BIAS_SWING;
      const band = amount * SORT_MAX_BAND;
      const lines = vertical ? w : h;
      const len = vertical ? h : w;
      const step = vertical ? w : 1;
      const buf = [];
      const inBand = (base, k) => Math.abs(lumaAt(d, (base + k * step) * CHANNELS) - centre) <= band;
      for (let l = 0; l < lines; l++) {
        if (hash(l, seed) > gate) continue;
        const base = vertical ? l : l * w;
        let s = 0;
        while (s < len) {
          while (s < len && !inBand(base, s)) s++;
          let e = s;
          while (e < len && inBand(base, e)) e++;
          if (e - s > 1) sortRun(d, base, step, s, e, descending, buf);
          s = e;
        }
      }
      return out;
    },
  },

  quant: {
    label: 'QUANT',
    desc: 'colour crushed to a handful of levels through an ordered dither',
    apply: async (img, p, amount) => {
      const out = copyOf(img);
      const { width: w, height: h } = img;
      const d = out.data;
      const levels = QUANT_MAX_LEVELS * Math.pow(1 - amount, QUANT_CURVE);
      const steps = [p.d ?? 0.5, p.e ?? 0.5, p.f ?? 0.5]
        .map(v => 1 - amount * QUANT_CHANNEL_SPREAD * (v - 0.5))
        .map(spread => FULL_SCALE / (Math.max(QUANT_MIN_LEVELS, Math.round(levels * spread)) - 1));
      const dither = amount * (QUANT_DITHER_BASE + (p.complexity ?? 0.5) * QUANT_DITHER_SPAN);
      const lift = (p.bias ?? 0) * amount * QUANT_BIAS_LIFT;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const spread = BAYER[(y & BAYER_SIDE) * CHANNELS + (x & BAYER_SIDE)] - 0.5;
          const i = (y * w + x) * CHANNELS;
          for (let ch = 0; ch < ALPHA; ch++) {
            const step = steps[ch];
            d[i + ch] = Math.round((d[i + ch] + lift + spread * step * dither) / step) * step;
          }
        }
      }
      return out;
    },
  },

  bend: {
    label: 'BEND',
    desc: 'the jpeg itself corrupted, byte by byte, inside the scan',
    // The one operator that damages the data rather than the picture: the frame
    // is re-encoded, bytes inside the entropy-coded scan are overwritten, and
    // the decoder is left to make of it what it will. Huffman codes are
    // variable-length, so a single wrong byte desynchronises everything after
    // it — that is where the dragged blocks and colour slides come from.
    apply: async (img, p, amount) => {
      const seed = p.seedNum ?? 0;
      const hits = Math.round(amount * amount * BEND_MAX_HITS
        * (BEND_CHURN_BASE + (p.churn ?? 0.3) * BEND_CHURN_SPAN));
      if (hits < 1) return copyOf(img);
      const bytes = await encodeJpeg(img, lerp(JPEG_QUALITY_CLEAN, JPEG_QUALITY_RUINED, amount));
      const scanStart = findScanStart(bytes);
      if (scanStart < 0) return copyOf(img);
      const from = scanStart + BEND_HEAD_GUARD;
      const burst = 1 + Math.round((p.a ?? 0.5) * BEND_MAX_BURST);
      const wasLit = meanLuma(img) > BEND_BLANK_LUMA;
      // a decoder that gives up returns nothing at all, so back off the damage
      // and ask again rather than handing the page a hole
      for (let attempt = 0; attempt <= BEND_RETRIES; attempt++) {
        const softened = Math.max(1, Math.round(hits / Math.pow(2, attempt)));
        const bent = bendScan(bytes, from, softened, burst, seed);
        const decoded = await decodeJpeg(bent, img.width, img.height).catch(() => null);
        if (!decoded) continue;
        if (wasLit && meanLuma(decoded) <= BEND_BLANK_LUMA) continue;
        return decoded;
      }
      return copyOf(img);
    },
  },

  amp: {
    label: 'AMP',
    desc: 'pixel rows played as sound through an amp rig and written back',
    options: {
      rig: { label: 'RIG', choices: { verb: 'VERB', dist: 'DIST', comb: 'COMB', echo: 'ECHO' }, initial: 'verb' },
      axis: { label: 'AXIS', choices: { x: 'ROWS', y: 'COLS' }, initial: 'x' },
    },
    apply: async (img, p, amount, opts = {}) => {
      if (!amount) return copyOf(img);
      const rig = AMP_RIGS[opts.rig] ?? AMP_RIGS.verb;
      const down = (opts.axis ?? 'x') === 'y';
      const { width: w, height: h } = img;
      const src = img.data;
      const out = copyOf(img);
      const dst = out.data;
      const line = down ? h : w;
      const count = w * h;
      const seed = AMP_IR_SEED + (p.seedNum ?? 0);
      const pixelAt = down
        ? i => ((i % h) * w + ((i / h) | 0)) * CHANNELS
        : i => i * CHANNELS;
      // one signal per colour channel, rendered separately — an effect tail
      // smears a colour into itself; interleaving would turn every tail into
      // rainbow noise
      const rendered = await Promise.all([0, 1, 2].map(ch => {
        const samples = new Float32Array(count);
        let mean = 0;
        for (let i = 0; i < count; i++) {
          const value = src[pixelAt(i) + ch];
          samples[i] = value;
          mean += value;
        }
        mean /= count;
        // centred on the channel mean, so the rig bends the content rather
        // than dragging the whole exposure toward black or white
        for (let i = 0; i < count; i++) samples[i] = (samples[i] - mean) / AMP_HALF_SCALE;
        return ampRender(samples, rig, p, amount, line, seed).then(signal => ({ signal, mean }));
      }));
      rendered.forEach(({ signal, mean }, ch) => {
        for (let i = 0; i < count; i++) dst[pixelAt(i) + ch] = mean + signal[i] * AMP_HALF_SCALE;
      });
      return out;
    },
  },

  byte: {
    label: 'BYTES',
    desc: 'runs of the raw buffer rotated out of channel alignment',
    apply: async (img, p, amount) => {
      const out = copyOf(img);
      const d = out.data;
      const seed = p.seedNum ?? 0;
      const runs = Math.round(amount * BYTE_MAX_RUNS
        * (BYTE_CHURN_BASE + (p.churn ?? 0.3) * BYTE_CHURN_SPAN));
      const longest = Math.round(d.length * BYTE_RUN_FRACTION * amount);
      for (let k = 0; k < runs; k++) {
        const len = BYTE_MIN_RUN + Math.floor(hash(k, seed) * longest);
        const from = Math.floor(hash(k, seed + 1) * (d.length - len));
        let by = 1 + Math.floor(hash(k, seed + 2) * BYTE_MAX_SHIFT);
        // a whole-pixel rotation only slides pixels; the damage we want is the
        // channels landing on each other's bytes
        if (by % CHANNELS === 0) by++;
        const run = d.slice(from, from + len);
        for (let i = 0; i < len; i++) d[from + i] = run[(i + by) % len];
        // a rotated alpha byte reads as a hole in the picture, not as damage
        for (let i = from; i < from + len; i++) if (i % CHANNELS === ALPHA) d[i] = OPAQUE;
      }
      return out;
    },
  },

  scan: {
    label: 'SCAN',
    desc: 'lines dropped and the last good one held in their place',
    apply: async (img, p, amount) => {
      const out = copyOf(img);
      const { width: w, height: h } = img;
      const d = out.data;
      const seed = p.seedNum ?? 0;
      const odds = Math.min(SCAN_MAX_ODDS,
        amount * (SCAN_BASE_ODDS + (p.decay ?? 0.3) * SCAN_DECAY_ODDS));
      const upward = (p.drift ?? 1) < 0;
      const rowBytes = w * CHANNELS;
      const longestRun = 1 + Math.round(amount * SCAN_MAX_RUN * (SCAN_RUN_BASE + (p.churn ?? 0.3)));
      // Holding a single line does nothing to a photograph — its neighbour looks
      // almost the same. A dropout only reads as damage once one good line is
      // smeared across a run of them.
      for (let n = 1; n < h;) {
        const y = upward ? h - 1 - n : n;
        if (hash(y, seed) >= odds) {
          n++;
          continue;
        }
        const run = 1 + Math.floor(hash(y, seed + 1) * longestRun);
        const held = upward ? y + 1 : y - 1;
        const from = held * rowBytes;
        for (let k = 0; k < run && n + k < h; k++) {
          const target = upward ? h - 1 - (n + k) : n + k;
          d.copyWithin(target * rowBytes, from, from + rowBytes);
        }
        n += run;
      }
      return out;
    },
  },

  rot: {
    label: 'ROT',
    desc: 'blooms of nothing eating the picture from the inside',
    apply: async (img, p, amount) => {
      const out = copyOf(img);
      const { width: w, height: h } = img;
      const d = out.data;
      const seed = p.seedNum ?? 0;
      const reach = Math.pow(amount, ROT_CURVE) * ROT_MAX_REACH * Math.min(w, h);
      if (reach < ROT_MIN_REACH) return out;
      const nuclei = 1 + Math.floor((p.a ?? 0.5) * ROT_MAX_NUCLEI);
      const bite = ROT_BASE_BITE + (p.density ?? 0.5) * ROT_BITE_SPAN;
      const jitter = (p.jitter ?? 0) * ROT_JITTER;
      const edge = ROT_EDGE * amount;
      const limit = reach + edge + jitter;
      const limitSq = limit * limit;
      const nx = [];
      const ny = [];
      for (let i = 0; i < nuclei; i++) {
        nx.push(hash(i + seed, 1) * w);
        ny.push(hash(i + seed, 2) * h);
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let nearest = Infinity;
          for (let i = 0; i < nuclei; i++) {
            const dx = x - nx[i];
            const dy = y - ny[i];
            const q = dx * dx + dy * dy;
            if (q < nearest) nearest = q;
          }
          if (nearest > limitSq) continue;
          const dist = Math.sqrt(nearest) + hash(x, y) * jitter;
          if (dist > reach + edge) continue;
          const i = (y * w + x) * CHANNELS;
          if (dist > reach) {
            d[i] = FULL_SCALE - d[i];
            d[i + 1] = FULL_SCALE - d[i + 1];
            d[i + 2] = FULL_SCALE - d[i + 2];
            continue;
          }
          if (hash(x + seed, y + 1) > bite) continue;
          d[i] = 0;
          d[i + 1] = 0;
          d[i + 2] = 0;
        }
      }
      return out;
    },
  },
};
