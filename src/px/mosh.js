// The honest datamosh for PX·77: motion is measured on one picture and spent
// on another. estimate() runs three-step block matching on downscaled luma
// and returns a vector field; apply() drags the target's pixels backwards
// along those vectors. Each apply reads the previous apply's output, so a
// repeated field accumulates into the I-frame-removal bloom instead of
// resetting. Everything is deterministic — no Math.random, no Date — the same
// frames always yield the same field and the same smear.

const CHANNELS = 4;

// Matching runs at this luma width whatever the camera hands over; height
// follows the frame's own aspect. 192 wide keeps estimate under a few
// milliseconds and still resolves a gesture a handful of pixels wide.
const LUMA_WIDTH = 192;
const BLOCK = 12;
// probe distances of the three-step search — reach ±7 internal pixels
const SEARCH_STEPS = [4, 2, 1];
// how much better a move must be than staying put, in SAD per pixel: flat
// walls and sensor noise otherwise match anywhere and the field explodes
const STILL_BIAS = 1.5;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const lumaAt = (d, i) => (d[i] * 77 + d[i + 1] * 151 + d[i + 2] * 28) >> 8;

function toLuma(frame, w, h) {
  const { width: fw, height: fh, data } = frame;
  const luma = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = Math.min(fh - 1, ((y + 0.5) * fh / h) | 0) * fw;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(fw - 1, ((x + 0.5) * fw / w) | 0);
      luma[y * w + x] = lumaAt(data, (row + sx) * CHANNELS);
    }
  }
  return luma;
}

function blockSad(next, prev, w, bx, by, bw, bh, dx, dy, bail) {
  let sum = 0;
  for (let y = 0; y < bh; y++) {
    const n = (by + y) * w + bx;
    const p = (by + y + dy) * w + bx + dx;
    for (let x = 0; x < bw; x++) {
      const diff = next[n + x] - prev[p + x];
      sum += diff < 0 ? -diff : diff;
    }
    if (sum >= bail) return sum;
  }
  return sum;
}

// Where did this block of `next` sit in `prev`? Three-step search around the
// zero vector, with a bias toward not moving at all: only a match that beats
// staying put by STILL_BIAS per pixel counts as motion.
function bestOffset(next, prev, w, h, bx, by, bw, bh) {
  let bestDx = 0;
  let bestDy = 0;
  let bestSad = blockSad(next, prev, w, bx, by, bw, bh, 0, 0, Infinity);
  const stillSad = bestSad;
  for (const step of SEARCH_STEPS) {
    const fromDx = bestDx;
    const fromDy = bestDy;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!ox && !oy) continue;
        const dx = fromDx + ox * step;
        const dy = fromDy + oy * step;
        if (bx + dx < 0 || by + dy < 0 || bx + dx + bw > w || by + dy + bh > h) continue;
        const sad = blockSad(next, prev, w, bx, by, bw, bh, dx, dy, bestSad);
        if (sad < bestSad) {
          bestSad = sad;
          bestDx = dx;
          bestDy = dy;
        }
      }
    }
  }
  if (stillSad - bestSad < STILL_BIAS * bw * bh) return [0, 0];
  return [bestDx, bestDy];
}

// out(p) = in(p - v(p)·strength): a backwards warp, so applying the same
// field again drags the already-dragged pixels further — the compounding is
// the whole point. Nearest-neighbour sampling keeps the grain crunchy instead
// of diffusing it into blur; the field itself is bilinear across block
// centres so the smear has no grid seams.
function warp(imageData, field, strength) {
  const { width: w, height: h, data: src } = imageData;
  const out = new ImageData(w, h);
  const dst = out.data;
  if (strength <= 0) {
    dst.set(src);
    return out;
  }
  const { gridW, gridH, vx, vy } = field;
  const pullX = w * strength;
  const pullY = h * strength;
  const colCell = new Int32Array(w);
  const colNext = new Int32Array(w);
  const colMix = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = ((x + 0.5) / w) * gridW - 0.5;
    const cell = clamp(Math.floor(u), 0, gridW - 1);
    colCell[x] = cell;
    colNext[x] = Math.min(cell + 1, gridW - 1);
    colMix[x] = clamp(u - cell, 0, 1);
  }
  for (let y = 0; y < h; y++) {
    const v = ((y + 0.5) / h) * gridH - 0.5;
    const cell = clamp(Math.floor(v), 0, gridH - 1);
    const r0 = cell * gridW;
    const r1 = Math.min(cell + 1, gridH - 1) * gridW;
    const fy = clamp(v - cell, 0, 1);
    let d = y * w * CHANNELS;
    for (let x = 0; x < w; x++, d += CHANNELS) {
      const c0 = colCell[x];
      const c1 = colNext[x];
      const fx = colMix[x];
      const topX = vx[r0 + c0] + (vx[r0 + c1] - vx[r0 + c0]) * fx;
      const botX = vx[r1 + c0] + (vx[r1 + c1] - vx[r1 + c0]) * fx;
      const topY = vy[r0 + c0] + (vy[r0 + c1] - vy[r0 + c0]) * fx;
      const botY = vy[r1 + c0] + (vy[r1 + c1] - vy[r1 + c0]) * fx;
      const sx = clamp(Math.round(x - (topX + (botX - topX) * fy) * pullX), 0, w - 1);
      const sy = clamp(Math.round(y - (topY + (botY - topY) * fy) * pullY), 0, h - 1);
      const s = (sy * w + sx) * CHANNELS;
      dst[d] = src[s];
      dst[d + 1] = src[s + 1];
      dst[d + 2] = src[s + 2];
      dst[d + 3] = src[s + 3];
    }
  }
  return out;
}

export function createMotionEstimator({ width, height }) {
  return {
    // prevFrame/nextFrame are ImageData of any consistent size — video frames,
    // usually a different aspect than the target. Returns a field:
    // { gridW, gridH, vx, vy } with vectors stored as fractions of the frame,
    // pointing the way the content moved, ready to spend at any resolution.
    estimate(prevFrame, nextFrame) {
      if (prevFrame.width !== nextFrame.width || prevFrame.height !== nextFrame.height) {
        throw new Error(`px mosh: frames disagree — ${prevFrame.width}×${prevFrame.height} vs ${nextFrame.width}×${nextFrame.height}`);
      }
      const lw = LUMA_WIDTH;
      const lh = Math.max(BLOCK, Math.round((LUMA_WIDTH * prevFrame.height) / prevFrame.width));
      const prev = toLuma(prevFrame, lw, lh);
      const next = toLuma(nextFrame, lw, lh);
      const gridW = Math.ceil(lw / BLOCK);
      const gridH = Math.ceil(lh / BLOCK);
      const vx = new Float32Array(gridW * gridH);
      const vy = new Float32Array(gridW * gridH);
      for (let gy = 0; gy < gridH; gy++) {
        for (let gx = 0; gx < gridW; gx++) {
          const bx = gx * BLOCK;
          const by = gy * BLOCK;
          const bw = Math.min(BLOCK, lw - bx);
          const bh = Math.min(BLOCK, lh - by);
          const [dx, dy] = bestOffset(next, prev, lw, lh, bx, by, bw, bh);
          // the block matched dx,dy away in the PREVIOUS frame, so the
          // content itself travelled the opposite way
          const i = gy * gridW + gx;
          vx[i] = -dx / lw;
          vy[i] = -dy / lh;
        }
      }
      return { gridW, gridH, vx, vy };
    },

    // Drags the target's pixels along the field, scaled by strength 0..1.
    // strength 0 is an exact identity. Always returns a NEW ImageData.
    apply(imageData, field, strength) {
      if (imageData.width !== width || imageData.height !== height) {
        throw new Error(`px mosh: target is ${imageData.width}×${imageData.height}, estimator built for ${width}×${height}`);
      }
      return warp(imageData, field, strength);
    },
  };
}
