/**
 * Настоящий вордмарк UNDERSTAV из экспорта Figma, разобранный на две части.
 *
 * Знак и кресты лежат в одном файле разными группами, и карточке они нужны порознь: буквы
 * стоят в макете, а кресты держат поля рамкой. Файл читается один раз, дальше живут два
 * растра, потому что перекраска через `source-in` дешевле повторного разбора SVG.
 *
 * Процедурный блэклеттер сцены сюда не годится: он собран из кривых шрифта и на афише в
 * ленте плывёт, а этот знак нарисован руками и держит форму на ногте.
 */

import { createLayer } from './layer.js';

// Знак лежит рядом с прочими ассетами и достаётся по пути, а не сборкой. Это первая
// редакция рисунка: афиша с недавних пор льёт в объём вторую, карточки остались на этой.
const LOGO_URL = 'assets/logo/understav-wordmark.svg';

const WORDMARK_GROUP = 'logotype';
const CROSSES_GROUP = 'frame-pluses';
// Разбор идёт на такой ширине: знак кладут на карточку кеглем от силы в половину её
// стороны, и запас вдвое снимает лестницу на диагоналях блэклеттера.
const RASTER_WIDTH = 2048;
const ALPHA_FLOOR = 8;
const ALPHA_STRIDE = 4;

async function rasterize(source, viewBox, width) {
  const [, , boxWidth, boxHeight] = viewBox.split(/\s+/).map(Number);
  const height = Math.round((width * boxHeight) / boxWidth);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">${source}</svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const layer = createLayer(width, height);
    layer.ctx.drawImage(image, 0, 0, width, height);
    return layer.canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Обрезка по краске: у группы знака поля виртуального холста шире самих букв. */
function trim(canvas) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let left = canvas.width;
  let right = 0;
  let top = canvas.height;
  let bottom = 0;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      if (data[(y * canvas.width + x) * ALPHA_STRIDE + ALPHA_STRIDE - 1] < ALPHA_FLOOR) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) return canvas;
  const cut = createLayer(right - left + 1, bottom - top + 1);
  cut.ctx.drawImage(canvas, -left, -top);
  return cut.canvas;
}

export async function loadLogo() {
  const response = await fetch(LOGO_URL);
  if (!response.ok) throw new Error(`Знак UNDERSTAV не отдался: ${response.status}`);
  const document_ = new DOMParser().parseFromString(await response.text(), 'image/svg+xml');
  const viewBox = document_.documentElement.getAttribute('viewBox');
  const groups = [WORDMARK_GROUP, CROSSES_GROUP].map((id) => document_.getElementById(id).outerHTML);
  const [wordmark, crosses] = await Promise.all(
    groups.map((group) => rasterize(group, viewBox, RASTER_WIDTH)),
  );
  return { wordmark: trim(wordmark), crosses };
}

/** Знак, перекрашенный под карточку: исходник красный, а серия живёт в палитре сцены. */
export function logoLayer(part, { width, color }) {
  const height = Math.round((width * part.height) / part.width);
  const layer = createLayer(width, height);
  layer.ctx.drawImage(part, 0, 0, width, height);
  layer.ctx.globalCompositeOperation = 'source-in';
  layer.ctx.fillStyle = color;
  layer.ctx.fillRect(0, 0, width, height);
  return layer.canvas;
}
