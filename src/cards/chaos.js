/**
 * Эффектор: разрушение готовой карточки по серийному рецепту.
 *
 * Словарь приёмов вырос вдвое, но включаются они не как попало. Серийный поток, один на
 * все шесть карточек, собирает рецепт: какие приёмы работают и с какой силой. Карточный
 * поток решает только, куда именно упадут пересадки и полосы на этой карточке. Так серия
 * разгромлена одинаково по духу и по-разному в деталях: это и есть укрощённый хаос,
 * а не шесть случайных аварий.
 *
 * Порядок словаря жёсткий: сначала геометрия (пересадки, размазы, полосы, волна, эхо),
 * потом цвет (негативы, развёртка, вспышки, каналы). В обратном порядке негативные плашки
 * резались бы полосами и читались бы мусором, а не приёмом.
 */

import { rgba } from './ink.js';
import { createLayer } from './layer.js';
import { chromatic, slices } from './wear.js';

const GRAFTS = [5, 12];
const GRAFT_WIDTH = [0.12, 0.5];
const GRAFT_HEIGHT = [0.025, 0.12];
const GRAFT_THROW_X = 0.28;
const GRAFT_THROW_Y = 0.08;

const SLICE_BANDS = 12;
const SLICE_SHIFT_UNITS = 3.5;

const INVERTS = [2, 5];
const INVERT_WIDTH = [0.1, 0.6];
const INVERT_HEIGHT = [0.02, 0.1];

const FLASHES = [2, 6];
const FLASH_ALPHA = [0.14, 0.4];

const CHROMA_OFFSET_UNITS = 1.4;

// Размаз: колонки кадра тянутся вниз, как зависший кадр перемотки.
const SMEARS = [4, 10];
const SMEAR_WIDTH = [0.015, 0.08];
const SMEAR_STRETCH = [2.5, 9];

// Волна: тонкие ленты кадра съезжают по синусу, фаза у каждой карточки своя.
const RIPPLE_BANDS = 26;
const RIPPLE_AMP_UNITS = [0.8, 2.6];

// Эхо: призрачные копии кадра, вдавленные сложением с уводом и лёгким масштабом.
const ECHOES = [1, 3];
const ECHO_ALPHA = [0.1, 0.24];
const ECHO_SHIFT_UNITS = 2.2;
const ECHO_SCALE = [0.985, 1.02];

// Развёртка: тёмные строки через равный шаг, кадр как с уставшего монитора.
const SCAN_STEP_UNITS = [1.1, 2.4];
const SCAN_ALPHA = [0.12, 0.3];

/** Пересадки: кусок кадра снимается со своего места и приживается в чужом. */
function grafts(ctx, frame, random, inks, strength) {
  const source = createLayer(frame.width, frame.height);
  source.ctx.drawImage(ctx.canvas, 0, 0);
  const count = Math.round(random.int(GRAFTS[0], GRAFTS[1]) * strength);
  for (let graft = 0; graft < count; graft += 1) {
    const width = frame.width * random.range(GRAFT_WIDTH[0], GRAFT_WIDTH[1]);
    const height = frame.height * random.range(GRAFT_HEIGHT[0], GRAFT_HEIGHT[1]);
    const x = random.range(0, frame.width - width);
    const y = random.range(0, frame.height - height);
    ctx.drawImage(
      source.canvas,
      x, y, width, height,
      x + random.range(-1, 1) * frame.width * GRAFT_THROW_X * strength,
      y + random.range(-1, 1) * frame.height * GRAFT_THROW_Y * strength,
      width, height,
    );
  }
}

/** Размаз: узкая строка кадра растягивается вниз в длинный подтёк. */
function smears(ctx, frame, random, inks, strength) {
  const source = createLayer(frame.width, frame.height);
  source.ctx.drawImage(ctx.canvas, 0, 0);
  const count = Math.round(random.int(SMEARS[0], SMEARS[1]) * strength);
  for (let smear = 0; smear < count; smear += 1) {
    const width = frame.width * random.range(SMEAR_WIDTH[0], SMEAR_WIDTH[1]);
    const x = random.range(0, frame.width - width);
    const y = random.range(frame.height * 0.1, frame.height * 0.85);
    const stretch = frame.unit * random.range(SMEAR_STRETCH[0], SMEAR_STRETCH[1]) * strength;
    ctx.drawImage(source.canvas, x, y, width, 2, x, y, width, stretch);
  }
}

/** Волна: ленты кадра едут по синусу, крыша и подвал остаются на месте. */
function ripple(ctx, frame, random, inks, strength) {
  const source = createLayer(frame.width, frame.height);
  source.ctx.drawImage(ctx.canvas, 0, 0);
  const bandHeight = frame.height / RIPPLE_BANDS;
  const amplitude = frame.unit * random.range(RIPPLE_AMP_UNITS[0], RIPPLE_AMP_UNITS[1]) * strength;
  const phase = random.range(0, Math.PI * 2);
  const waves = random.range(1.5, 3.5);
  for (let band = 0; band < RIPPLE_BANDS; band += 1) {
    const y = band * bandHeight;
    const shift = Math.sin(phase + (band / RIPPLE_BANDS) * Math.PI * 2 * waves) * amplitude;
    ctx.drawImage(source.canvas, 0, y, frame.width, bandHeight, shift, y, frame.width, bandHeight);
  }
}

/** Эхо: кадр вдавливается в себя же со сдвигом, как двойная экспозиция. */
function echoes(ctx, frame, random, inks, strength) {
  const source = createLayer(frame.width, frame.height);
  source.ctx.drawImage(ctx.canvas, 0, 0);
  const count = random.int(ECHOES[0], ECHOES[1]);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let echo = 0; echo < count; echo += 1) {
    const scale = random.range(ECHO_SCALE[0], ECHO_SCALE[1]);
    ctx.globalAlpha = random.range(ECHO_ALPHA[0], ECHO_ALPHA[1]) * strength;
    ctx.drawImage(
      source.canvas,
      random.range(-1, 1) * frame.unit * ECHO_SHIFT_UNITS * strength,
      random.range(-1, 1) * frame.unit * ECHO_SHIFT_UNITS * strength,
      frame.width * scale,
      frame.height * scale,
    );
  }
  ctx.restore();
}

/** Инверсия плашками: difference с белым переворачивает кусок кадра в негатив. */
function inverts(ctx, frame, random, inks, strength) {
  ctx.save();
  ctx.globalCompositeOperation = 'difference';
  ctx.fillStyle = '#ffffff';
  const count = Math.max(1, Math.round(random.int(INVERTS[0], INVERTS[1]) * strength));
  for (let plate = 0; plate < count; plate += 1) {
    ctx.fillRect(
      random.range(0, frame.width * 0.8),
      random.range(0, frame.height * 0.92),
      frame.width * random.range(INVERT_WIDTH[0], INVERT_WIDTH[1]),
      frame.height * random.range(INVERT_HEIGHT[0], INVERT_HEIGHT[1]),
    );
  }
  ctx.restore();
}

/** Развёртка: тёмные строки с равным шагом поверх всего кадра. */
function scanlines(ctx, frame, random, inks, strength) {
  const step = frame.unit * random.range(SCAN_STEP_UNITS[0], SCAN_STEP_UNITS[1]);
  ctx.save();
  ctx.fillStyle = rgba(inks.void, random.range(SCAN_ALPHA[0], SCAN_ALPHA[1]) * strength);
  for (let y = 0; y < frame.height; y += step * 2) {
    ctx.fillRect(0, y, frame.width, step);
  }
  ctx.restore();
}

/** Цветные вспышки: тонкие плашки жара и холода, вжатые сложением. */
function flashes(ctx, frame, random, inks, strength) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const count = Math.round(random.int(FLASHES[0], FLASHES[1]) * strength);
  for (let flash = 0; flash < count; flash += 1) {
    ctx.fillStyle = rgba(
      random.pick([inks.ember, inks.moon, inks.blood]),
      random.range(FLASH_ALPHA[0], FLASH_ALPHA[1]),
    );
    ctx.fillRect(
      0,
      random.range(0, frame.height * 0.95),
      frame.width,
      frame.unit * random.range(0.6, 3),
    );
  }
  ctx.restore();
}

/** Разъезд каналов: наружу через wear, сила рецепта уходит в стрength. */
function chroma(ctx, frame, random, inks, strength) {
  chromatic(ctx, frame, {
    offset: frame.unit * CHROMA_OFFSET_UNITS * strength,
    strength: Math.min(1, strength),
  });
}

/** Полосный разъезд: наружу через wear, тот же приём, что у износа, но крупнее. */
function bands(ctx, frame, random, inks, strength) {
  slices(ctx, frame, random, {
    bands: SLICE_BANDS,
    shift: frame.unit * SLICE_SHIFT_UNITS * strength,
  });
}

// Порядок жёсткий: геометрия до цвета. Вероятность у зрелищных приёмов ниже,
// чтобы обычный рецепт не включал всё сразу.
const VOCABULARY = [
  { id: 'grafts', run: grafts, odds: 0.75 },
  { id: 'smears', run: smears, odds: 0.5 },
  { id: 'bands', run: bands, odds: 0.65 },
  { id: 'ripple', run: ripple, odds: 0.45 },
  { id: 'echoes', run: echoes, odds: 0.45 },
  { id: 'inverts', run: inverts, odds: 0.7 },
  { id: 'scanlines', run: scanlines, odds: 0.4 },
  { id: 'flashes', run: flashes, odds: 0.7 },
  { id: 'chroma', run: chroma, odds: 0.8 },
];

const RECIPE_MIN = 3;
const RECIPE_MAX = 6;
const STRENGTH = [0.6, 1.4];

/**
 * Рецепт разгрома: серийный поток решает, какие приёмы работают и с какой силой.
 * Один рецепт держит все шесть карточек, поэтому серия громится одинаково по духу.
 */
export function createChaosRecipe(series) {
  const picked = VOCABULARY
    .map((effect) => ({ ...effect, strength: series.range(STRENGTH[0], STRENGTH[1]), on: series() < effect.odds }))
    .filter((effect) => effect.on);
  // Пустой или худой рецепт добирается с головы словаря: геометрия важнее цвета.
  for (const effect of VOCABULARY) {
    if (picked.length >= RECIPE_MIN) break;
    if (!picked.some((entry) => entry.id === effect.id)) {
      picked.push({ ...effect, strength: series.range(STRENGTH[0], STRENGTH[1]) });
    }
  }
  picked.sort((a, b) => VOCABULARY.findIndex((e) => e.id === a.id) - VOCABULARY.findIndex((e) => e.id === b.id));
  return picked.slice(0, RECIPE_MAX);
}

export function applyChaos(ctx, frame, random, inks, recipe) {
  for (const effect of recipe) {
    effect.run(ctx, frame, random, inks, effect.strength);
  }
}
