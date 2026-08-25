// Live decomposition operators for PX-77's bloom stage. Each operator is a
// per-frame processor with the same shape:
//
//   process(work, frame, field, opts, state) -> ImageData
//
//   work   persistent ImageData at canvas size, carried across frames so an
//          effect can compound on its own output
//   frame  the incoming camera/video feed, ImageData at feed resolution
//   field  the motion field from the estimator: { gridW, gridH, vx, vy },
//          vectors stored as fractions of the frame
//   opts   { estimator, strength, blend }: the two live sliders plus the
//          size-bound warp estimator that bloom needs
//   state  a scratch object private to the selected mode, wiped when the mode
//          changes, so each operator keeps its own history and lookup buffers
//
// Every operator fuses the feed's MOTION with the picture: `work` is the
// generated picture plus its accumulated decay, and it stays the substrate
// at all times. The feed contributes its motion field always; its texture
// enters only through `blend` (the FEED slider), gated by motion the way
// injectTexture does. At blend 0 the output is built entirely from the
// picture's own pixels, however displaced or decayed.
//
// The processor either mutates `work` and returns it, or returns a fresh
// buffer that becomes the next `work`. Buffers are reused through `state` so an
// operator running every animation frame allocates nothing steady-state.

const CHANNELS = 4;
const OPAQUE = 255;

// A block that shifted this fraction of the frame reads as full motion. Shared
// with the estimator's own sense of scale so "waving" means the same thing to
// every operator.
const MOTION_REF = 0.02;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const lumaOf = (d, i) => (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8;

// Work pixel to motion-field cell, cached until the sizes change.
function ensureGrid(state, w, h, field) {
  if (state.gW === w && state.gH === h && state.gGW === field.gridW && state.gGH === field.gridH) return;
  state.gW = w; state.gH = h; state.gGW = field.gridW; state.gGH = field.gridH;
  state.gCol = new Int32Array(w);
  for (let x = 0; x < w; x++) state.gCol[x] = Math.min(field.gridW - 1, ((x * field.gridW) / w) | 0);
  state.gRow = new Int32Array(h);
  for (let y = 0; y < h; y++) state.gRow[y] = Math.min(field.gridH - 1, ((y * field.gridH) / h) | 0);
}

function fieldAverage(field) {
  const cells = field.gridW * field.gridH;
  let sx = 0;
  let sy = 0;
  for (let c = 0; c < cells; c++) { sx += field.vx[c]; sy += field.vy[c]; }
  return { vx: sx / cells, vy: sy / cells };
}

// A still feed would freeze every operator solid. This oscillator stands in
// for the missing motion: `calm` rises toward 1 as the feed goes still and
// the internal drive takes over, and real movement pushes it back out, so
// waving at the camera always wins over the generator.
const IDLE_RATE = 0.045;

function idleDrive(state, field) {
  state.phase = (state.phase ?? 0) + IDLE_RATE;
  const avg = fieldAverage(field);
  const mag = Math.hypot(avg.vx, avg.vy) / MOTION_REF;
  return { phase: state.phase, calm: clamp(1 - mag, 0, 1) };
}

// The codec keeps splicing fresh texture into whatever moves: the feed's own
// pixels bleed into the smear wherever the motion is. bloom's original helper,
// now shared and parametrised on how hard the feed pushes.
function injectTexture(work, frame, field, blend) {
  const { width: w, height: h, data: d } = work;
  const f = frame.data;
  const cells = field.gridW * field.gridH;
  const gates = new Float32Array(cells);
  for (let c = 0; c < cells; c++) {
    const mag = Math.hypot(field.vx[c], field.vy[c]);
    gates[c] = blend * Math.min(1, mag / MOTION_REF);
  }
  for (let y = 0; y < h; y++) {
    const gridRow = Math.min(field.gridH - 1, ((y * field.gridH) / h) | 0) * field.gridW;
    const frameRow = (((y * frame.height) / h) | 0) * frame.width;
    for (let x = 0; x < w; x++) {
      const t = gates[gridRow + Math.min(field.gridW - 1, ((x * field.gridW) / w) | 0)];
      if (t === 0) continue;
      const s = ((frameRow + ((x * frame.width) / w) | 0) * CHANNELS);
      const i = (y * w + x) * CHANNELS;
      d[i] += (f[s] - d[i]) * t;
      d[i + 1] += (f[s + 1] - d[i + 1]) * t;
      d[i + 2] += (f[s + 2] - d[i + 2]) * t;
    }
  }
}

// Backwards block-warp along the motion, feeding live texture into the moving
// parts: the untouched original bloom, kept exactly as it was.
function bloom(work, frame, field, opts) {
  const next = opts.estimator.apply(work, field, opts.strength);
  if (opts.blend > 0) injectTexture(next, frame, field, opts.blend);
  return next;
}

// The picture dragged along the motion with its red and blue torn off-axis:
// every channel is moved backwards along the local vector, red reaching
// furthest and blue trailing, nearest-neighbour like the bloom warp so the
// drag compounds crunchily instead of fogging. A still scene moves nothing
// and the picture holds.
const CHROMA_SPREAD_FRAC = 0.025;
const CHROMA_SPLIT = 0.6;
const CHROMA_IDLE_FREQ = 0.018;
const CHROMA_IDLE_FRAC = 0.35;
const CHROMA_IDLE_OY_SCALE = 0.6;

function chroma(work, frame, field, opts, state) {
  const { width: w, height: h, data: d } = work;
  ensureGrid(state, w, h, field);
  if (!state.src || state.src.length !== d.length) state.src = new Uint8ClampedArray(d.length);
  state.src.set(d);
  const src = state.src;
  const drive = idleDrive(state, field);
  const spread = opts.strength * CHROMA_SPREAD_FRAC * w;
  const invRef = 1 / MOTION_REF;
  const lead = 1 + CHROMA_SPLIT;
  const lag = 1 - CHROMA_SPLIT;
  for (let y = 0; y < h; y++) {
    const gy = state.gRow[y] * field.gridW;
    const idleOx = Math.sin(drive.phase + y * CHROMA_IDLE_FREQ) * drive.calm * spread * CHROMA_IDLE_FRAC;
    const idleOy = Math.cos(drive.phase * 0.8 + y * CHROMA_IDLE_FREQ) * drive.calm * spread * CHROMA_IDLE_FRAC * CHROMA_IDLE_OY_SCALE;
    for (let x = 0; x < w; x++) {
      const cell = gy + state.gCol[x];
      const ox = clamp(field.vx[cell] * invRef, -1, 1) * spread + idleOx;
      const oy = clamp(field.vy[cell] * invRef, -1, 1) * spread + idleOy;
      const gOx = ox | 0;
      const gOy = oy | 0;
      const rOx = (ox * lead) | 0;
      const rOy = (oy * lead) | 0;
      const bOx = (ox * lag) | 0;
      const bOy = (oy * lag) | 0;
      if (rOx === 0 && rOy === 0 && gOx === 0 && gOy === 0 && bOx === 0 && bOy === 0) continue;
      const i = (y * w + x) * CHANNELS;
      const rIdx = (clamp(y - rOy, 0, h - 1) * w + clamp(x - rOx, 0, w - 1)) * CHANNELS;
      const gIdx = (clamp(y - gOy, 0, h - 1) * w + clamp(x - gOx, 0, w - 1)) * CHANNELS;
      const bIdx = (clamp(y - bOy, 0, h - 1) * w + clamp(x - bOx, 0, w - 1)) * CHANNELS;
      d[i] = src[rIdx];
      d[i + 1] = src[gIdx + 1];
      d[i + 2] = src[bIdx + 2];
      d[i + 3] = OPAQUE;
    }
  }
  if (opts.blend > 0) injectTexture(work, frame, field, opts.blend);
  return work;
}

// Motion knocks ghosts out of the picture: wherever the feed moves, a copy of
// the picture lands a throw away along the motion vector in a trail buffer
// that fades over frames, and the picture underneath erodes where its ghosts
// were knocked loose. The composite is picture-over-trail by lighten, so the
// picture stays while its ghosts drift and burn out.
const GHOST_THROW_FRAC = 0.12;
const GHOST_FADE = 0.93;
const GHOST_ERODE = 0.06;
const GHOST_IDLE_GATE = 0.12;
const GHOST_IDLE_FREQ = 0.016;

function ghost(work, frame, field, opts, state) {
  const { width: w, height: h, data: d } = work;
  ensureGrid(state, w, h, field);
  if (!state.base || state.base.width !== w || state.base.height !== h) {
    state.base = new ImageData(new Uint8ClampedArray(d), w, h);
    state.trail = new Uint8ClampedArray(d.length);
  }
  const base = state.base.data;
  const trail = state.trail;
  const drive = idleDrive(state, field);
  const throwPx = opts.strength * GHOST_THROW_FRAC * w;
  const invRef = 1 / MOTION_REF;
  const cells = field.gridW * field.gridH;
  if (!state.cellGate || state.cellGate.length !== cells) {
    state.cellGate = new Float32Array(cells);
    state.cellOx = new Int32Array(cells);
    state.cellOy = new Int32Array(cells);
  }
  for (let c = 0; c < cells; c++) {
    state.cellGate[c] = Math.min(1, Math.hypot(field.vx[c], field.vy[c]) * invRef);
    state.cellOx[c] = (clamp(field.vx[c] * invRef, -1, 1) * throwPx) | 0;
    state.cellOy[c] = (clamp(field.vy[c] * invRef, -1, 1) * throwPx) | 0;
  }
  const idleGate = drive.calm * GHOST_IDLE_GATE;
  for (let y = 0; y < h; y++) {
    const gy = state.gRow[y] * field.gridW;
    const idleOx = (Math.sin(drive.phase + y * GHOST_IDLE_FREQ) * drive.calm * throwPx) | 0;
    for (let x = 0; x < w; x++) {
      const cell = gy + state.gCol[x];
      const gate = Math.min(1, state.cellGate[cell] + idleGate);
      const sx = clamp(x - state.cellOx[cell] - idleOx, 0, w - 1);
      const sy = clamp(y - state.cellOy[cell], 0, h - 1);
      const s = (sy * w + sx) * CHANNELS;
      const i = (y * w + x) * CHANNELS;
      // only real motion erodes the picture; the idle pulse just keeps faint
      // ghosts breathing without eating the substrate on a still feed
      const dim = 1 - state.cellGate[cell] * opts.strength * GHOST_ERODE;
      for (let c = 0; c < 3; c++) {
        const knocked = base[s + c] * gate;
        const faded = trail[i + c] * GHOST_FADE;
        trail[i + c] = knocked > faded ? knocked : faded;
        base[i + c] *= dim;
        const b = base[i + c];
        const t = trail[i + c];
        d[i + c] = b > t ? b : t;
      }
      d[i + 3] = OPAQUE;
    }
  }
  if (opts.blend > 0) injectTexture(state.base, frame, field, opts.blend);
  return work;
}

// Motion shears the picture into horizontal strips: each strip's sideways
// displacement accumulates while its rows keep moving and slowly snaps back
// home when they stop. Strips wrap around the edge, so a hard wave tears the
// picture into sliding bands that later reassemble.
const SHRED_STRIP_H = 6;
const SHRED_STEP_FRAC = 0.045;
const SHRED_RETURN = 0.985;
const SHRED_IDLE_FREQ = 0.5;
const SHRED_IDLE_STEP = 0.25;

function rotateRow(d, base, w, shift, scratch) {
  let s = shift % w;
  if (s < 0) s += w;
  if (s === 0) return;
  const rowBytes = w * CHANNELS;
  scratch.set(d.subarray(base, base + rowBytes));
  const splitBytes = (w - s) * CHANNELS;
  d.set(scratch.subarray(0, splitBytes), base + s * CHANNELS);
  d.set(scratch.subarray(splitBytes), base);
}

function shred(work, frame, field, opts, state) {
  const { width: w, height: h, data: d } = work;
  const strips = Math.ceil(h / SHRED_STRIP_H);
  if (!state.target || state.target.length !== strips || state.scratch?.length !== w * CHANNELS) {
    state.target = new Float32Array(strips);
    state.applied = new Int32Array(strips);
    state.scratch = new Uint8ClampedArray(w * CHANNELS);
  }
  const drive = idleDrive(state, field);
  const step = opts.strength * SHRED_STEP_FRAC * w;
  const invRef = 1 / MOTION_REF;
  for (let strip = 0; strip < strips; strip++) {
    const yMid = Math.min(h - 1, strip * SHRED_STRIP_H + (SHRED_STRIP_H >> 1));
    const gy = Math.min(field.gridH - 1, ((yMid * field.gridH) / h) | 0) * field.gridW;
    let vx = 0;
    for (let gx = 0; gx < field.gridW; gx++) vx += field.vx[gy + gx];
    vx /= field.gridW;
    const push = clamp(vx * invRef, -1, 1) * step;
    const sway = Math.sin(drive.phase + strip * SHRED_IDLE_FREQ) * drive.calm * step * SHRED_IDLE_STEP;
    state.target[strip] = (state.target[strip] + push + sway) * SHRED_RETURN;
    const delta = Math.round(state.target[strip]) - state.applied[strip];
    if (delta === 0) continue;
    state.applied[strip] += delta;
    const yEnd = Math.min(h, strip * SHRED_STRIP_H + SHRED_STRIP_H);
    for (let y = strip * SHRED_STRIP_H; y < yEnd; y++) rotateRow(d, y * w * CHANNELS, w, delta, state.scratch);
  }
  if (opts.blend > 0) injectTexture(work, frame, field, opts.blend);
  return work;
}

// The picture itself pixel-sorts, but only where it moves: one neighbour-swap
// pass per frame bubbles bright pixels the way the row is going, so waving
// melts the picture's own bands sideways and stillness lets them set. The
// feed's texture only enters through the blend gate, fresh material for the
// melt to eat.
const MELT_THRESHOLD_MAX = 210;
const MELT_GATE = 0.04;
const MELT_IDLE_FREQ = 0.05;
const MELT_IDLE_DRIVE = 0.5;

function sortRow(d, base, w, dir, threshold) {
  const start = dir < 0 ? w - 2 : 0;
  const end = dir < 0 ? -1 : w - 1;
  const stepDir = dir < 0 ? -1 : 1;
  for (let x = start; x !== end; x += stepDir) {
    const a = base + x * CHANNELS;
    const b = base + (x + 1) * CHANNELS;
    const la = lumaOf(d, a);
    const lb = lumaOf(d, b);
    if (lb <= threshold || la >= lb) continue;
    for (let c = 0; c < CHANNELS; c++) {
      const tmp = d[a + c];
      d[a + c] = d[b + c];
      d[b + c] = tmp;
    }
  }
}

function melt(work, frame, field, opts, state) {
  const { width: w, height: h, data: d } = work;
  const drive = idleDrive(state, field);
  if (opts.blend > 0) injectTexture(work, frame, field, opts.blend);
  const threshold = MELT_THRESHOLD_MAX * (1 - opts.strength);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(field.gridH - 1, ((y * field.gridH) / h) | 0);
    let rowVx = 0;
    for (let gx = 0; gx < field.gridW; gx++) rowVx += field.vx[gy * field.gridW + gx];
    rowVx /= field.gridW;
    // a still row melts only under the idle drift, sweeping back and forth;
    // any real motion in the row overrides it and sets the direction
    const drift = Math.sin(drive.phase + y * MELT_IDLE_FREQ) * drive.calm * MOTION_REF * MELT_IDLE_DRIVE;
    const activity = (rowVx + drift) / MOTION_REF;
    if (Math.abs(activity) < MELT_GATE) continue;
    sortRow(d, y * w * CHANNELS, w, activity >= 0 ? 1 : -1, threshold);
  }
  return work;
}

// Order is the chip order. bloom stays first and first-selected so the stage
// opens exactly as it did before.
export const LIVE_OPS = {
  bloom: {
    label: 'BLOOM',
    desc: 'motion drags the picture, the live feed bleeds into whatever moves',
    process: bloom,
  },
  chroma: {
    label: 'CHROMA',
    desc: 'motion tears the picture\'s red and blue apart, and the split compounds',
    process: chroma,
  },
  ghost: {
    label: 'GHOST',
    desc: 'motion knocks fading ghosts out of the picture, which erodes where they left',
    process: ghost,
  },
  shred: {
    label: 'SHRED',
    desc: 'motion slides the picture apart in strips that tear loose and slowly slot back',
    process: shred,
  },
  melt: {
    label: 'MELT',
    desc: 'the picture pixel-sorts where it moves, bright runs melting the way the row goes',
    process: melt,
  },
};

export const LIVE_OP_DEFAULT = 'bloom';
