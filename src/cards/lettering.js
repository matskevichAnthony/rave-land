/**
 * Набор строки на холсте карточки: разрядка, выключка по формату и трафаретные перемычки.
 *
 * Готика приходит из `understav/gothic.js`: там объявлено, каким файлом набирается латиница,
 * каким кириллица и откуда их брать, и второе такое объявление разъехалось бы с первым на
 * первой же замене шрифта. Гротеск наоборот заводится здесь: это стек системных начертаний
 * без единого файла проекта, и плитам сцены он нужен под свою узость, а карточке под свою.
 */

import { gothicFaceFor } from '../understav/gothic.js';
import { createLayer } from './layer.js';

export { gothicFaceFor };

// Узкий гротеск: имя выключается по краям полей, и широкое начертание на длинном имени
// пришлось бы сжимать до неузнаваемости.
export const NARROW_FACE = {
  weight: 'bold',
  stack: "'Liberation Sans Narrow', 'Nimbus Sans Narrow', 'Arial Narrow', sans-serif",
};

// Ширина строки в canvas растёт с кеглем строго линейно, поэтому кегль под ширину не
// подбирается перебором: строка меряется один раз на опоре и делится.
const REFERENCE_PX = 200;
const SPACE_ADVANCE = 0.3;
const CAP_FALLBACK = 0.72;

// Перемычки трафарета: две прорези поперёк прописной. Толще пяти сотых буква разваливается
// на обрубки, тоньше двух прорезь пропадает после сжатия в мессенджере.
const BAR_HEIGHTS = [0.34, 0.7];
const BAR_THICKNESS = 0.062;

function fontOf(face, pixels) {
  return `${face.weight} ${pixels}px ${face.stack}`;
}

function glyphAdvance(ctx, glyph, pixels) {
  if (glyph === ' ') return pixels * SPACE_ADVANCE;
  return ctx.measureText(glyph).width;
}

function trackedWidth(ctx, text, pixels, tracking) {
  const gap = pixels * tracking;
  let width = -gap;
  for (const glyph of text) width += glyphAdvance(ctx, glyph, pixels) + gap;
  return Math.max(width, 0);
}

export function measureLine(ctx, text, { pixels, tracking, face }) {
  ctx.font = fontOf(face, pixels);
  return trackedWidth(ctx, text, pixels, tracking);
}

/** Высота прописной при заданном кегле: строки на афише стоят по ней, а не по базовой. */
export function capHeight(ctx, text, { pixels, face }) {
  ctx.font = fontOf(face, pixels);
  const ascent = ctx.measureText(text).actualBoundingBoxAscent;
  return ascent > 0 ? ascent : pixels * CAP_FALLBACK;
}

/**
 * Кегль, разрядка и ширина, при которых имя займёт колонку ровно по краям.
 *
 * Сначала кегль: он растёт до тех пор, пока строка не упрётся в ширину или в потолок.
 * Короткое имя вроде VXLX упирается в потолок раньше ширины, и остаток колонки добирается
 * разрядкой: иначе в серии из шести карточек два имени стояли бы вполовину поля.
 *
 * Множитель пульта ломает эту выключку намеренно. Пока он равен единице, имя стоит по
 * краям полей, как и стояло. Как только его двинули, разрядка замирает на своей, а строка
 * встаёт натуральной шириной: иначе ужатое вдвое имя расползлось бы по колонке разрядкой и
 * читалось бы не мельче прежнего. Ширину возвращаем наружу, потому что по ней направление
 * заново ставит строку в середину колонки.
 */
export function justifyLine(ctx, text, { width, maxPixels, tracking, face, scale = 1 }) {
  ctx.font = fontOf(face, REFERENCE_PX);
  const perPixel = trackedWidth(ctx, text, REFERENCE_PX, tracking) / REFERENCE_PX;
  const pixels = Math.min(perPixel > 0 ? width / perPixel : maxPixels, maxPixels) * scale;
  const gaps = [...text].length - 1;
  const slack = scale === 1 && gaps > 0
    ? (width - measureLine(ctx, text, { pixels, tracking, face })) / gaps
    : 0;
  const spread = tracking + Math.max(0, slack / pixels);
  return { pixels, tracking: spread, width: measureLine(ctx, text, { pixels, tracking: spread, face }) };
}

/**
 * Строка в разрядку от левого края к базовой линии.
 *
 * Canvas ставит знаки вплотную, а свойство `letterSpacing` есть не во всех браузерах, где
 * афишу будут открывать. Разрядка на афише несёт весь ритм мелкой строки, поэтому знаки
 * ставятся поштучно.
 */
export function fillTracked(ctx, text, { x, y, pixels, tracking, face, color }) {
  ctx.font = fontOf(face, pixels);
  if (color) ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const gap = pixels * tracking;
  let pen = x;
  for (const glyph of text) {
    if (glyph !== ' ') ctx.fillText(glyph, pen, y);
    pen += glyphAdvance(ctx, glyph, pixels) + gap;
  }
  return pen - x - gap;
}

function barsOf(ctx, text, { x, y, pixels, tracking, face }) {
  const cap = capHeight(ctx, text, { pixels, face });
  const width = measureLine(ctx, text, { pixels, tracking, face });
  return BAR_HEIGHTS.map((at) => ({
    x, y: y - cap * at, width, height: cap * BAR_THICKNESS,
  }));
}

/** Имя трафаретом: буквы стоят краской, перемычки выедают их насквозь. */
export function stencilLine(ctx, text, line) {
  const layer = createLayer(ctx.canvas.width, ctx.canvas.height);
  fillTracked(layer.ctx, text, line);
  layer.ctx.globalCompositeOperation = 'destination-out';
  for (const bar of barsOf(ctx, text, line)) {
    layer.ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
  }
  ctx.drawImage(layer.canvas, 0, 0);
}

/** Имя, прорезанное в плите: буквы выедают слой, перемычки возвращают металл на место. */
export function punchStencil(ctx, text, { bridge, ...line }) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  fillTracked(ctx, text, { ...line, color: '#000000' });
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = bridge;
  for (const bar of barsOf(ctx, text, line)) ctx.fillRect(bar.x, bar.y, bar.width, bar.height);
  ctx.restore();
}
