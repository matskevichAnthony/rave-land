/**
 * Фото артиста на карточке.
 *
 * Снимок никогда не ложится сырым: он пересобирается в клетки и красится красками серии,
 * поэтому любая фотография с любым балансом света входит в вайб, а не спорит с ним.
 * Приём и полоса размещения серийные (одинаковые на всех шести карточках), кадрирование
 * и помехи карточные: серия единая, карточки живые.
 *
 * Откуда берётся снимок: поле `photo` у артиста в `public/understav.json`, путь от корня
 * страницы, файлы лежат в `public/assets/photos/`. Артист без поля живёт без фото.
 */

import { mix } from './ink.js';

// Клетка растра в юнитах кадра: крупнее клетка, грубее и графичнее снимок.
const CELL_UNITS = [0.7, 1.5];

// Полоса снимка: доли высоты кадра под верхний край и собственную высоту.
const BAND_TOP = [0.12, 0.38];
const BAND_HEIGHT = [0.3, 0.52];

// Прозрачность подачи и сила помех шреда в клетках.
const PHOTO_ALPHA = 0.92;
const SHRED_ODDS = 0.35;
const SHRED_SHIFT = [1, 5];

// Куда смотрит кадрирование по вертикали: лица обычно в верхней трети снимка.
const FOCUS_Y = 0.2;

// Плотность точки растра: степень поджимает светлые, чтобы точки не сливались в кашу.
const DOT_GAMMA = 1.4;
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };
const BYTE = 255;

/**
 * Загрузка снимков лайнапа. Отсутствующий или битый файл не валит серию:
 * такой артист просто остаётся без фото, как будто поля не было.
 */
export async function loadPhotos(event) {
  const entries = Object.entries(event.artists ?? {}).filter(([, extra]) => extra.photo);
  const photos = new Map();
  await Promise.all(entries.map(([name, extra]) => new Promise((done) => {
    const image = new Image();
    image.onload = () => {
      photos.set(name, image);
      done();
    };
    image.onerror = () => done();
    image.src = extra.photo;
  })));
  return photos;
}

/** Сетка яркостей: снимок кадрируется с покрытием и ужимается до клеток растра. */
function sampleGrid(image, cols, rows, focalX) {
  const work = document.createElement('canvas');
  work.width = cols;
  work.height = rows;
  const ctx = work.getContext('2d');
  const aspect = cols / rows;
  let cropWidth = image.width;
  let cropHeight = image.height;
  if (cropWidth / cropHeight > aspect) {
    cropWidth = cropHeight * aspect;
  } else {
    cropHeight = cropWidth / aspect;
  }
  const cropX = (image.width - cropWidth) * focalX;
  const cropY = (image.height - cropHeight) * FOCUS_Y;
  ctx.drawImage(image, cropX, cropY, cropWidth, cropHeight, 0, 0, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  const grid = new Float64Array(cols * rows);
  for (let cell = 0; cell < grid.length; cell += 1) {
    const at = cell * 4;
    grid[cell] = (data[at] * LUMA.r + data[at + 1] * LUMA.g + data[at + 2] * LUMA.b) / BYTE;
  }
  return grid;
}

const TREATMENTS = [
  // Дуотон: клетка заливается смесью тьмы и краски серии по своей яркости.
  function duotone(ctx, grid, place, inks, lit, random) {
    const { cols, rows, x, y, cell } = place;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        ctx.fillStyle = mix(inks.void, lit, grid[row * cols + col]);
        ctx.fillRect(x + col * cell, y + row * cell, cell + 1, cell + 1);
      }
    }
  },
  // Растр: тёмная плита и точки света, радиус точки растёт с яркостью.
  function raster(ctx, grid, place, inks, lit) {
    const { cols, rows, x, y, cell } = place;
    ctx.fillStyle = inks.void;
    ctx.fillRect(x, y, cols * cell, rows * cell);
    ctx.fillStyle = lit;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const tone = grid[row * cols + col] ** DOT_GAMMA;
        if (tone <= 0) continue;
        ctx.beginPath();
        ctx.arc(x + (col + 0.5) * cell, y + (row + 0.5) * cell, (cell / 2) * tone, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },
  // Шред: дуотон, у которого часть рядов уехала вбок, как сорванная развёртка.
  function shred(ctx, grid, place, inks, lit, random) {
    const { cols, rows, x, y, cell } = place;
    for (let row = 0; row < rows; row += 1) {
      const shift = random() < SHRED_ODDS
        ? Math.round(random.range(SHRED_SHIFT[0], SHRED_SHIFT[1])) * random.sign() * cell
        : 0;
      for (let col = 0; col < cols; col += 1) {
        ctx.fillStyle = mix(inks.void, lit, grid[row * cols + col]);
        ctx.fillRect(x + col * cell + shift, y + row * cell, cell + 1, cell + 1);
      }
    }
  },
];

/**
 * Снимок на карточку. `serial` держит серию (приём, полоса, клетка, краска),
 * `random` держит карточку (кадрирование, помехи): вайб один, лица живут по-своему.
 */
export function drawPhoto(ctx, frame, image, serial, random, inks) {
  const treatment = TREATMENTS[Math.floor(serial() * TREATMENTS.length)];
  const lit = serial() < 0.5 ? inks.ember : inks.moon;
  const cell = frame.unit * serial.range(CELL_UNITS[0], CELL_UNITS[1]);
  const y = frame.height * serial.range(BAND_TOP[0], BAND_TOP[1]);
  const height = frame.height * serial.range(BAND_HEIGHT[0], BAND_HEIGHT[1]);

  const cols = Math.max(1, Math.floor(frame.width / cell));
  const rows = Math.max(1, Math.floor(height / cell));
  const grid = sampleGrid(image, cols, rows, random());

  ctx.save();
  ctx.globalAlpha = PHOTO_ALPHA;
  treatment(ctx, grid, { cols, rows, x: 0, y, cell }, inks, lit, random);
  ctx.restore();
}
