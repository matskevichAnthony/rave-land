import * as THREE from 'three';

const SHEET_WIDTH = 128;
const SHEET_HEIGHT = 64;
const TORSO_SHEET_WIDTH = 192;
const TORSO_BACK_X = 64;
const TORSO_SIDE_X = 128;
const PART_SIZE = 64;
const SHOE_HEIGHT = 32;
const HAND_SIZE = 16;
const CAP_SIZE = 32;

function createLayer(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, ctx: canvas.getContext('2d') };
}

function toTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function shade(color, lightnessDelta) {
  return new THREE.Color(color).offsetHSL(0, 0, lightnessDelta).getStyle();
}

function fill(ctx, color, x, y, width, height) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width, height);
}

function darken(ctx, alpha, x, y, width, height) {
  fill(ctx, `rgba(0, 0, 0, ${alpha})`, x, y, width, height);
}

function grain(ctx, random, x, y, width, height, density, alpha) {
  const count = Math.floor(width * height * density);
  for (let i = 0; i < count; i += 1) {
    const dark = random() < 0.55;
    ctx.fillStyle = dark ? `rgba(0, 0, 0, ${alpha})` : `rgba(255, 255, 255, ${alpha * 0.5})`;
    ctx.fillRect(x + Math.floor(random() * width), y + Math.floor(random() * height), 1, 1);
  }
}

function creases(ctx, random, x, y, width, height, count, alpha) {
  for (let i = 0; i < count; i += 1) {
    const length = 3 + Math.floor(random() * width * 0.4);
    const startX = x + Math.floor(random() * Math.max(1, width - length));
    const startY = y + Math.floor(random() * height);
    darken(ctx, alpha, startX, startY, length, 1);
    fill(ctx, 'rgba(255, 255, 255, 0.07)', startX, startY + 1, length, 1);
  }
}

function foldLines(ctx, random, x, y, width, height, count, alpha) {
  for (let i = 0; i < count; i += 1) {
    const lineX = x + 3 + Math.floor(random() * (width - 6));
    const length = 8 + Math.floor(random() * height * 0.4);
    const startY = y + Math.floor(random() * Math.max(1, height - length));
    const bend = Math.floor(length * (0.3 + random() * 0.4));
    darken(ctx, alpha, lineX, startY, 1, bend);
    darken(ctx, alpha, lineX + 1, startY + bend, 1, length - bend);
  }
}

function splatter(ctx, random, centerX, centerY, radius, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const dots = Math.floor(radius * radius * 4);
  for (let i = 0; i < dots; i += 1) {
    const angle = random() * Math.PI * 2;
    const distance = random() * radius;
    ctx.fillRect(
      Math.round(centerX + Math.cos(angle) * distance * 1.4),
      Math.round(centerY + Math.sin(angle) * distance),
      1,
      1,
    );
  }
  ctx.globalAlpha = 1;
}

function dirtStains(ctx, random, x, y, width, height, amount) {
  const count = Math.round(amount * 5);
  for (let i = 0; i < count; i += 1) {
    splatter(ctx, random, x + random() * width, y + random() * height, 1.5 + random() * 3, '#241c12', 0.4);
  }
}

function accentTargets(baseCtx, glowCtx, color) {
  const targets = [{ ctx: baseCtx, color }];
  if (glowCtx) targets.push({ ctx: glowCtx, color });
  return targets;
}

function accentRect(targets, x, y, width, height) {
  for (const target of targets) fill(target.ctx, target.color, x, y, width, height);
}

function paintHairMass(ctx, random, look, x, y, width, height) {
  fill(ctx, look.hair, x, y, width, height);
  for (let i = 0; i < width / 3; i += 1) {
    const strandX = x + Math.floor(random() * width);
    darken(ctx, 0.3, strandX, y, 1, height - Math.floor(random() * 4));
  }
  fill(ctx, 'rgba(255, 255, 255, 0.06)', x, y + 2, width, 1);
}

function paintFaceHair(ctx, random, look) {
  if (look.hairStyle === 'none') return;
  if (look.hairStyle === 'buzz') {
    ctx.globalAlpha = 0.55;
    fill(ctx, look.hair, 0, 0, PART_SIZE, 11);
    ctx.globalAlpha = 1;
    return;
  }
  for (let x = 0; x < PART_SIZE; x += 1) {
    fill(ctx, look.hair, x, 0, 1, 8 + Math.floor(random() * 5));
  }
  const templeDepth = look.hairStyle === 'long' ? 46 : 22;
  fill(ctx, look.hair, 0, 0, 7, templeDepth + Math.floor(random() * 4));
  fill(ctx, look.hair, 57, 0, 7, templeDepth + Math.floor(random() * 4));
}

function paintEyes(ctx, random, look) {
  const socket = `rgba(22, 14, 26, ${look.eyeShadow})`;
  fill(ctx, socket, 13, 24, 14, 11);
  fill(ctx, socket, 37, 24, 14, 11);
  fill(ctx, '#c7bfae', 15, 27, 9, 4);
  fill(ctx, '#c7bfae', 40, 27, 9, 4);
  darken(ctx, 0.4, 15, 27, 9, 1);
  darken(ctx, 0.4, 40, 27, 9, 1);
  const gaze = Math.floor(random() * 5);
  fill(ctx, '#161210', 16 + gaze, 28, 3, 3);
  fill(ctx, '#161210', 41 + gaze, 28, 3, 3);
  fill(ctx, 'rgba(64, 40, 62, 0.45)', 14, 31, 11, 1);
  fill(ctx, 'rgba(64, 40, 62, 0.45)', 39, 31, 11, 1);
  fill(ctx, 'rgba(64, 40, 62, 0.25)', 15, 32, 9, 1);
  fill(ctx, 'rgba(64, 40, 62, 0.25)', 40, 32, 9, 1);
}

function paintBrows(ctx) {
  fill(ctx, '#1d1712', 14, 23, 6, 2);
  fill(ctx, '#1d1712', 19, 24, 6, 2);
  fill(ctx, '#1d1712', 44, 23, 6, 2);
  fill(ctx, '#1d1712', 39, 24, 6, 2);
}

function paintNose(ctx) {
  darken(ctx, 0.22, 30, 30, 2, 10);
  darken(ctx, 0.5, 28, 40, 2, 1);
  darken(ctx, 0.5, 34, 40, 2, 1);
  fill(ctx, 'rgba(255, 255, 255, 0.1)', 31, 37, 2, 1);
}

function paintMouth(ctx, look) {
  if (look.lips) {
    fill(ctx, look.lips, 24, 44, 16, 5);
  }
  fill(ctx, '#191014', 23, 45, 18, 2);
  fill(ctx, '#191014', 22, 47, 2, 1);
  fill(ctx, '#191014', 40, 47, 2, 1);
  darken(ctx, 0.15, 31, 41, 1, 3);
}

function paintBandage(ctx, random) {
  fill(ctx, '#a29a89', 0, 3, PART_SIZE, 13);
  grain(ctx, random, 0, 3, PART_SIZE, 13, 0.08, 0.15);
  darken(ctx, 0.22, 0, 7, PART_SIZE, 1);
  darken(ctx, 0.22, 0, 12, PART_SIZE, 1);
  darken(ctx, 0.35, 0, 15, PART_SIZE, 1);
  splatter(ctx, random, 44, 8, 4, '#4c1714', 0.7);
  splatter(ctx, random, 40, 12, 2, '#4c1714', 0.5);
}

function paintFaceShadow(ctx) {
  fill(ctx, 'rgba(8, 8, 16, 0.4)', 0, 0, PART_SIZE, PART_SIZE);
  fill(ctx, 'rgba(12, 10, 20, 0.5)', 0, 0, PART_SIZE, 22);
  fill(ctx, '#b0a696', 16, 28, 7, 3);
  fill(ctx, '#b0a696', 41, 28, 7, 3);
  fill(ctx, '#0c0a08', 18, 29, 3, 2);
  fill(ctx, '#0c0a08', 43, 29, 3, 2);
}

function paintFace(ctx, random, look) {
  fill(ctx, look.skin, 0, 0, PART_SIZE, PART_SIZE);
  grain(ctx, random, 0, 0, PART_SIZE, PART_SIZE, 0.1, 0.1);
  darken(ctx, 0.2, 0, 0, 6, PART_SIZE);
  darken(ctx, 0.2, 58, 0, 6, PART_SIZE);
  darken(ctx, 0.25, 0, 56, PART_SIZE, 8);
  fill(ctx, 'rgba(40, 30, 45, 0.16)', 8, 36, 8, 12);
  fill(ctx, 'rgba(40, 30, 45, 0.16)', 48, 36, 8, 12);
  paintFaceHair(ctx, random, look);
  paintBrows(ctx);
  paintEyes(ctx, random, look);
  paintNose(ctx);
  paintMouth(ctx, look);
  dirtStains(ctx, random, 4, 34, 56, 26, look.dirt * 0.5);
  if (look.bandage) paintBandage(ctx, random);
  if (look.faceShadow) paintFaceShadow(ctx);
}

function paintHeadBack(ctx, random, look) {
  const x = PART_SIZE;
  if (look.hood) {
    fill(ctx, shade(look.top, -0.03), x, 0, PART_SIZE, PART_SIZE);
    grain(ctx, random, x, 0, PART_SIZE, PART_SIZE, 0.1, 0.12);
    foldLines(ctx, random, x, 4, PART_SIZE, 56, 6, 0.3);
    return;
  }
  fill(ctx, look.skin, x, 0, PART_SIZE, PART_SIZE);
  grain(ctx, random, x, 0, PART_SIZE, PART_SIZE, 0.08, 0.1);
  darken(ctx, 0.25, x, 52, PART_SIZE, 12);
  if (look.hairStyle === 'none') return;
  const hairDepth = look.hairStyle === 'long' ? 52 : 36;
  if (look.hairStyle === 'buzz') {
    ctx.globalAlpha = 0.55;
    fill(ctx, look.hair, x, 0, PART_SIZE, 30);
    ctx.globalAlpha = 1;
    return;
  }
  paintHairMass(ctx, random, look, x, 0, PART_SIZE, hairDepth);
}

export function paintHead(look, random) {
  const { canvas, ctx } = createLayer(SHEET_WIDTH, SHEET_HEIGHT);
  paintFace(ctx, random, look);
  paintHeadBack(ctx, random, look);
  return { map: toTexture(canvas), emissiveMap: null };
}

function paintCollar(ctx, random, look) {
  if (look.topStyle === 'hoodie') {
    fill(ctx, shade(look.top, -0.04), 0, 0, PART_SIZE, 7);
    darken(ctx, 0.3, 0, 6, PART_SIZE, 1);
    fill(ctx, '#8a8578', 27, 7, 1, 9);
    fill(ctx, '#8a8578', 36, 7, 1, 9);
    return;
  }
  if (look.topStyle === 'jacket') {
    fill(ctx, '#120e16', 26, 0, 12, 5);
    darken(ctx, 0.3, 0, 0, 64, 5);
    fill(ctx, '#6d6a62', 31, 4, 2, 56);
    for (let y = 6; y < 58; y += 4) darken(ctx, 0.3, 31, y, 2, 1);
    return;
  }
  if (look.topStyle === 'coat') {
    darken(ctx, 0.2, 20, 0, 2, 12);
    darken(ctx, 0.2, 42, 0, 2, 12);
    for (let y = 10; y < 56; y += 9) fill(ctx, '#2a2620', 31, y, 2, 2);
    return;
  }
  darken(ctx, 0.25, 0, 0, PART_SIZE, 4);
}

function paintStrap(ctx, random) {
  for (let y = 0; y < PART_SIZE; y += 1) {
    darken(ctx, 0.5, 8 + Math.floor(y * 0.55), y, 5, 1);
  }
  fill(ctx, '#6d6a62', 24, 30, 3, 3);
}

function paintChestAccent(targets) {
  for (let x = 8; x < 56; x += 5) {
    const barHeight = 3 + ((x * 7) % 9);
    accentRect(targets, x, 34 - barHeight, 3, barHeight);
  }
  accentRect(targets, 8, 36, 48, 1);
}

function paintBackAccent(targets) {
  const centerX = TORSO_BACK_X + 32;
  const centerY = 28;
  const radius = 12;
  const steps = 26;
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    accentRect(
      targets,
      Math.round(centerX + Math.cos(angle) * radius),
      Math.round(centerY + Math.sin(angle) * radius * 0.8),
      2,
      2,
    );
  }
  accentRect(targets, centerX - 1, centerY - 1, 3, 3);
}

function paintGothPrint(ctx, random) {
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < 220; i += 1) {
    fill(ctx, '#6a6675', 20 + Math.floor(random() * 24), 16 + Math.floor(random() * 22), 1, 1);
  }
  ctx.globalAlpha = 1;
  fill(ctx, '#14101a', 26, 22, 4, 5);
  fill(ctx, '#14101a', 34, 22, 4, 5);
  fill(ctx, '#14101a', 30, 29, 4, 3);
}

export function paintTorso(look, random) {
  const base = createLayer(TORSO_SHEET_WIDTH, SHEET_HEIGHT);
  const glow = look.glow ? createLayer(TORSO_SHEET_WIDTH, SHEET_HEIGHT) : null;
  if (glow) fill(glow.ctx, '#000000', 0, 0, TORSO_SHEET_WIDTH, SHEET_HEIGHT);
  const ctx = base.ctx;

  fill(ctx, look.top, 0, 0, TORSO_SHEET_WIDTH, SHEET_HEIGHT);
  grain(ctx, random, 0, 0, TORSO_SHEET_WIDTH, SHEET_HEIGHT, 0.1, 0.12);
  creases(ctx, random, 2, 30, 60, 30, 8, 0.25);
  creases(ctx, random, TORSO_BACK_X + 2, 26, 60, 34, 9, 0.25);
  creases(ctx, random, TORSO_SIDE_X + 2, 24, 60, 36, 6, 0.22);
  darken(ctx, 0.3, 2, 0, 1, SHEET_HEIGHT);
  darken(ctx, 0.3, 61, 0, 1, SHEET_HEIGHT);
  darken(ctx, 0.25, 0, 61, TORSO_SHEET_WIDTH, 3);
  darken(ctx, 0.2, TORSO_BACK_X, 8, PART_SIZE, 1);
  darken(ctx, 0.22, TORSO_SIDE_X, 0, PART_SIZE, 8);
  darken(ctx, 0.25, TORSO_SIDE_X + 31, 4, 2, 56);
  paintCollar(ctx, random, look);
  if (look.archetype === 'goth' && !look.accent) paintGothPrint(ctx, random);
  if (look.strap) paintStrap(ctx, random);
  if (look.blood) {
    splatter(ctx, random, 20, 34, 6, '#431511', 0.6);
    splatter(ctx, random, 44, 50, 4, '#431511', 0.5);
    splatter(ctx, random, TORSO_BACK_X + 36, 40, 3, '#431511', 0.4);
    splatter(ctx, random, TORSO_SIDE_X + 22, 44, 3, '#431511', 0.4);
  }
  dirtStains(ctx, random, 0, 20, TORSO_SHEET_WIDTH, 44, look.dirt);
  if (look.accent) {
    const targets = accentTargets(ctx, glow ? glow.ctx : null, look.accent);
    paintChestAccent(targets);
    paintBackAccent(targets);
  }
  return { map: toTexture(base.canvas), emissiveMap: glow ? toTexture(glow.canvas) : null };
}

export function paintSleeve(look, random) {
  const base = createLayer(PART_SIZE, PART_SIZE);
  const glow = look.glow ? createLayer(PART_SIZE, PART_SIZE) : null;
  if (glow) fill(glow.ctx, '#000000', 0, 0, PART_SIZE, PART_SIZE);
  const ctx = base.ctx;

  fill(ctx, look.top, 0, 0, PART_SIZE, PART_SIZE);
  grain(ctx, random, 0, 0, PART_SIZE, PART_SIZE, 0.1, 0.12);
  foldLines(ctx, random, 0, 6, PART_SIZE, 46, 5, 0.25);
  darken(ctx, 0.15, 0, 0, PART_SIZE, 3);
  darken(ctx, 0.25, 0, 55, PART_SIZE, 1);
  fill(ctx, shade(look.top, -0.03), 0, 56, PART_SIZE, 8);
  dirtStains(ctx, random, 0, 20, PART_SIZE, 44, look.dirt * 0.7);
  if (look.accent) {
    const targets = accentTargets(ctx, glow ? glow.ctx : null, look.accent);
    accentRect(targets, 0, 20, PART_SIZE, 2);
  }
  return { map: toTexture(base.canvas), emissiveMap: glow ? toTexture(glow.canvas) : null };
}

export function paintPants(look, random, { belt = false, hem = false } = {}) {
  const base = createLayer(SHEET_WIDTH, SHEET_HEIGHT);
  const glow = look.glow ? createLayer(SHEET_WIDTH, SHEET_HEIGHT) : null;
  if (glow) fill(glow.ctx, '#000000', 0, 0, SHEET_WIDTH, SHEET_HEIGHT);
  const ctx = base.ctx;

  fill(ctx, look.pants, 0, 0, SHEET_WIDTH, SHEET_HEIGHT);
  grain(ctx, random, 0, 0, SHEET_WIDTH, SHEET_HEIGHT, 0.1, 0.12);
  fill(ctx, 'rgba(255, 255, 255, 0.06)', 32, 0, 1, SHEET_HEIGHT);
  fill(ctx, 'rgba(255, 255, 255, 0.06)', 96, 0, 1, SHEET_HEIGHT);
  foldLines(ctx, random, 0, 8, PART_SIZE, 40, 4, 0.22);
  foldLines(ctx, random, PART_SIZE, 8, PART_SIZE, 40, 4, 0.22);
  if (belt) {
    fill(ctx, '#15121a', 0, 0, SHEET_WIDTH, 5);
    fill(ctx, '#77726a', 30, 1, 4, 3);
  }
  if (hem) {
    creases(ctx, random, 0, 46, SHEET_WIDTH, 16, 12, 0.28);
    dirtStains(ctx, random, 0, 48, SHEET_WIDTH, 16, look.dirt + 0.4);
  }
  dirtStains(ctx, random, 0, 16, SHEET_WIDTH, 40, look.dirt * 0.6);
  if (look.accent) {
    const targets = accentTargets(ctx, glow ? glow.ctx : null, look.accent);
    accentRect(targets, PART_SIZE + 30, 0, 2, SHEET_HEIGHT);
  }
  return { map: toTexture(base.canvas), emissiveMap: glow ? toTexture(glow.canvas) : null };
}

export function paintShoe(look, random) {
  const { canvas, ctx } = createLayer(PART_SIZE, SHOE_HEIGHT);
  fill(ctx, look.shoe, 0, 0, PART_SIZE, SHOE_HEIGHT);
  grain(ctx, random, 0, 0, PART_SIZE, SHOE_HEIGHT, 0.12, 0.14);
  fill(ctx, look.sole, 0, 23, PART_SIZE, 9);
  darken(ctx, 0.45, 0, 22, PART_SIZE, 1);
  darken(ctx, 0.2, 0, 26, PART_SIZE, 6);
  for (let i = 0; i < 4; i += 1) {
    fill(ctx, '#8f887a', 24 + i * 4, 6 + (i % 2) * 2, 2, 1);
  }
  dirtStains(ctx, random, 0, 12, PART_SIZE, 14, look.dirt + 0.3);
  return { map: toTexture(canvas), emissiveMap: null };
}

export function paintHand(look, random) {
  const { canvas, ctx } = createLayer(HAND_SIZE, HAND_SIZE);
  fill(ctx, look.skin, 0, 0, HAND_SIZE, HAND_SIZE);
  darken(ctx, 0.28, 0, 0, HAND_SIZE, HAND_SIZE);
  grain(ctx, random, 0, 0, HAND_SIZE, HAND_SIZE, 0.15, 0.12);
  darken(ctx, 0.3, 0, 9, HAND_SIZE, 1);
  return { map: toTexture(canvas), emissiveMap: null };
}

export function paintHair(look, random) {
  const { canvas, ctx } = createLayer(CAP_SIZE, CAP_SIZE);
  paintHairMass(ctx, random, look, 0, 0, CAP_SIZE, CAP_SIZE);
  return { map: toTexture(canvas), emissiveMap: null };
}

export function paintHood(look, random) {
  const { canvas, ctx } = createLayer(CAP_SIZE, CAP_SIZE);
  fill(ctx, shade(look.top, -0.02), 0, 0, CAP_SIZE, CAP_SIZE);
  grain(ctx, random, 0, 0, CAP_SIZE, CAP_SIZE, 0.12, 0.14);
  foldLines(ctx, random, 0, 2, CAP_SIZE, 28, 4, 0.3);
  darken(ctx, 0.3, 0, 29, CAP_SIZE, 3);
  return { map: toTexture(canvas), emissiveMap: null };
}
