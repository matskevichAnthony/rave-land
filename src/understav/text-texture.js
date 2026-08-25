import * as THREE from 'three';

/**
 * Трафареты для стальных плит сцены UNDERSTAV.
 *
 * Текст рисуется кодом на canvas и уходит в материал альфа-маской, а не картинкой поверх:
 * плита остаётся физическим предметом, буквы в ней прорезаны и светятся эмиссией.
 */

export const NARROW_FACE = {
  weight: 'bold',
  stack: "'Liberation Sans Narrow', 'Nimbus Sans Narrow', 'Arial Narrow', sans-serif",
};

const REFERENCE_PX = 200;
const SPACE_ADVANCE = 0.3;
const CAP_FALLBACK = 0.72;
const LONG_SIDE = 2048;
// Пол по короткой стороне: у длинной строки плита низкая, и холст по одной длинной стороне
// оставлял на штрих полторы сотни пикселей. Готика на них рассыпается в мыло.
const SHORT_SIDE_MIN = 384;
const ANISOTROPY = 8;

// Отметины меряются высотой плиты, а не шириной: толщина штриха идёт от кегля, а кегль от
// высоты. По ширине длинное имя получало пятна размером со свой же штрих и переставало
// читаться ровно там, где плита шире.
const SPECK_COUNT = 640;
const SPECK_RADIUS = 0.02;
const SPECK_MIN_ALPHA = 0.6;
const SCRATCH_COUNT = 14;
const SCRATCH_MIN_LENGTH = 0.25;
const SCRATCH_MAX_LENGTH = 1.8;
const SCRATCH_MIN_THICKNESS = 0.0015;
const SCRATCH_MAX_THICKNESS = 0.006;
const SCRATCH_TILT = 0.08;
// Грязь поверх крапа: она не выедает букву насквозь, а гасит её пятнами. Крап и царапины
// работают дырой, и одним крапом имя чистят до трафарета из типографии либо съедают целиком,
// среднего у них нет. Пятно вполсилы даёт как раз середину: буква залапана, но читается.
const BLOT_COUNT = 34;
const BLOT_RADIUS = [0.06, 0.26];
const BLOT_ALPHA = [0.08, 0.3];

// Предел растяжения буквы: дальше узкий гротеск теряет рисунок знака и читается набором плит.
const JUSTIFY_STRETCH_MAX = 2.6;

const MASK_INK = '#ffffff';
const MASK_VOID = '#000000';

let sharedMeasureContext = null;

function fontOf(face, pixels) {
  return `${face.weight} ${pixels}px ${face.stack}`;
}

function measureContext() {
  if (!sharedMeasureContext) {
    sharedMeasureContext = document.createElement('canvas').getContext('2d');
  }
  return sharedMeasureContext;
}

function glyphAdvance(context, glyph, pixels) {
  if (glyph === ' ') return pixels * SPACE_ADVANCE;
  return context.measureText(glyph).width;
}

function trackedWidth(context, text, pixels, tracking) {
  const gap = pixels * tracking;
  let width = -gap;
  for (const glyph of text) width += glyphAdvance(context, glyph, pixels) + gap;
  return Math.max(width, 0);
}

function capPerFont(context, text) {
  const ascent = context.measureText(text).actualBoundingBoxAscent;
  return ascent > 0 ? ascent / REFERENCE_PX : CAP_FALLBACK;
}

/** Сколько ширины строка займёт на каждый метр высоты прописной буквы. */
export function measureWidthPerCap(text, tracking, face) {
  const context = measureContext();
  context.font = fontOf(face, REFERENCE_PX);
  const capPixels = capPerFont(context, text) * REFERENCE_PX;
  return trackedWidth(context, text, REFERENCE_PX, tracking) / capPixels;
}

function rustMarks(rng) {
  const specks = Array.from({ length: SPECK_COUNT }, () => ({
    x: rng(),
    y: rng(),
    radius: rng.range(0.25, 1) * SPECK_RADIUS,
    alpha: rng.range(SPECK_MIN_ALPHA, 1),
  }));
  const scratches = Array.from({ length: SCRATCH_COUNT }, () => ({
    x: rng(),
    y: rng(),
    length: rng.range(SCRATCH_MIN_LENGTH, SCRATCH_MAX_LENGTH),
    thickness: rng.range(SCRATCH_MIN_THICKNESS, SCRATCH_MAX_THICKNESS),
    tilt: rng.range(-SCRATCH_TILT, SCRATCH_TILT),
  }));
  const blots = Array.from({ length: BLOT_COUNT }, () => ({
    x: rng(),
    y: rng(),
    radius: rng.range(...BLOT_RADIUS),
    alpha: rng.range(...BLOT_ALPHA),
  }));
  return { specks, scratches, blots };
}

function erode(context, canvas, marks) {
  context.fillStyle = MASK_VOID;
  for (const speck of marks.specks) {
    context.globalAlpha = speck.alpha;
    context.beginPath();
    context.arc(
      speck.x * canvas.width,
      speck.y * canvas.height,
      speck.radius * canvas.height,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  for (const blot of marks.blots) {
    context.globalAlpha = blot.alpha;
    context.beginPath();
    context.arc(
      blot.x * canvas.width,
      blot.y * canvas.height,
      blot.radius * canvas.height,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
  context.globalAlpha = 1;
  for (const scratch of marks.scratches) {
    context.save();
    context.translate(scratch.x * canvas.width, scratch.y * canvas.height);
    context.rotate(scratch.tilt);
    context.fillRect(0, 0, scratch.length * canvas.height, scratch.thickness * canvas.height);
    context.restore();
  }
}

/**
 * Разгон строки до полной ширины плиты.
 *
 * Сначала буквы становятся шире, и только когда шире уже некрасиво, остаток добирается
 * разрядкой: короткое имя, растянутое одной разрядкой, рассыпается на отдельные знаки,
 * а растянутое одними буквами превращается в кашу из палок.
 */
function justifyRun(context, text, fontPixels, tracking, usableWidth) {
  const natural = trackedWidth(context, text, fontPixels, tracking);
  const gap = fontPixels * tracking;
  if (natural >= usableWidth || natural <= 0) return { stretch: 1, gap };
  const stretch = Math.min(usableWidth / natural, JUSTIFY_STRETCH_MAX);
  const gaps = Math.max([...text].length - 1, 1);
  return { stretch, gap: gap * stretch + (usableWidth - natural * stretch) / gaps };
}

function paintMask(context, canvas, marks, text, { face, tracking, capFraction, padding, justify = false }) {
  context.fillStyle = MASK_VOID;
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (!text) return;

  const usableWidth = canvas.width * (1 - padding * 2);
  context.font = fontOf(face, REFERENCE_PX);
  const capRatio = capPerFont(context, text);
  let fontPixels = (canvas.height * capFraction) / capRatio;
  context.font = fontOf(face, fontPixels);
  let width = trackedWidth(context, text, fontPixels, tracking);
  if (width > usableWidth) {
    fontPixels *= usableWidth / width;
    context.font = fontOf(face, fontPixels);
    width = trackedWidth(context, text, fontPixels, tracking);
  }

  const capPixels = capRatio * fontPixels;
  const baseline = (canvas.height + capPixels) / 2;
  const run = justify
    ? justifyRun(context, text, fontPixels, tracking, usableWidth)
    : { stretch: 1, gap: fontPixels * tracking };
  let cursor = justify ? (canvas.width - usableWidth) / 2 : (canvas.width - width) / 2;

  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.fillStyle = MASK_INK;
  // Растяжение живёт в преобразовании холста, а ширина буквы меряется без него: `measureText`
  // отдаёт размер в системе шрифта и текущего преобразования не знает.
  context.save();
  context.scale(run.stretch, 1);
  for (const glyph of text) {
    context.fillText(glyph, cursor / run.stretch, baseline);
    cursor += glyphAdvance(context, glyph, fontPixels) * run.stretch + run.gap;
  }
  context.restore();
  if (marks) erode(context, canvas, marks);
}

/**
 * Трафарет под плиту заданных мировых пропорций.
 *
 * Потёртости берут только имена артистов (`worn`): на них разрушение читается как след
 * зала, а на дате и подписи оно съедает мелкий штрих и оставляет кашу вместо строки.
 * Отметины считаются один раз, потому что `paint` зовут и на пересчёте отсчёта дней.
 */
export function createStencil({ width, height, rng, worn = false }) {
  const aspect = width / height;
  const short = Math.max(LONG_SIDE / Math.max(aspect, 1 / aspect), SHORT_SIDE_MIN);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(aspect >= 1 ? short * aspect : short);
  canvas.height = Math.round(aspect >= 1 ? short : short / aspect);

  const context = canvas.getContext('2d');
  const marks = worn ? rustMarks(rng) : null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = ANISOTROPY;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;

  return {
    texture,
    paint(text, options) {
      paintMask(context, canvas, marks, text, options);
      texture.needsUpdate = true;
    },
  };
}
