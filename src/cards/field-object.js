import { createNoise2D } from 'simplex-noise';
import { between } from '../procedural/random.js';
import { createLayer } from './layer.js';

/**
 * Предмет, которого никто не рисовал: он вырастает из шума по сиду.
 *
 * Карточка направления «Поле» держит одно ровное поле и на нём одну маленькую непонятную
 * штуку. Штуку нельзя нарисовать руками, иначе шесть карточек серии будут шестью рисунками
 * одного автора; её выращивают из шума, и тогда каждая карточка получает свой предмет, а
 * серию держит не сюжет, а правило.
 *
 * Отдаётся холст с прозрачным фоном: цвет поля кладёт направление, здесь только форма.
 * Форм три, и они намеренно разные по природе. Мембрана это оптика, замкнутая граница с
 * массой внутри. Контур это срез поля, слои без центра. Осколки это обломок, у которого
 * нет ни границы, ни слоёв. Одна форма на три карточки читалась бы шаблоном.
 */

const KINDS = ['membrane', 'contour', 'shards'];

const NOISE_SCALE = [1.6, 3.4];
const MEMBRANE_LOBES = [3, 7];
const MEMBRANE_WOBBLE = 0.26;
const MEMBRANE_MASS_STEPS = 26;
const MEMBRANE_MASS_ALPHA = 0.5;
const CONTOUR_RINGS = [7, 14];
const CONTOUR_SAMPLES = 220;
const CONTOUR_WOBBLE = 0.5;
const SHARD_COUNT = [9, 18];
const SHARD_SPAN = [0.06, 0.3];

const TAU = Math.PI * 2;

/** Радиус в долях половины стороны: шум гуляет по углу, а не по времени. */
function wobbledRadius(noise, angle, scale, wobble) {
  return 1 + noise(Math.cos(angle) * scale, Math.sin(angle) * scale) * wobble;
}

function traceLobe(ctx, noise, { radius, scale, wobble, lobes }) {
  ctx.beginPath();
  for (let step = 0; step <= CONTOUR_SAMPLES; step += 1) {
    const angle = (step / CONTOUR_SAMPLES) * TAU;
    const lobed = 1 + Math.sin(angle * lobes) * wobble * 0.5;
    const r = radius * wobbledRadius(noise, angle, scale, wobble) * lobed;
    ctx[step === 0 ? 'moveTo' : 'lineTo'](Math.cos(angle) * r, Math.sin(angle) * r);
  }
  ctx.closePath();
}

/** Мембрана: замкнутая граница, внутри неё органическая масса. */
function paintMembrane(ctx, size, random, ink) {
  const noise = createNoise2D(random);
  const scale = between(random, NOISE_SCALE[0], NOISE_SCALE[1]);
  const lobes = Math.round(between(random, MEMBRANE_LOBES[0], MEMBRANE_LOBES[1]));
  const radius = size / 2;

  ctx.save();
  ctx.translate(size / 2, size / 2);
  traceLobe(ctx, noise, { radius: radius * 0.92, scale, wobble: MEMBRANE_WOBBLE, lobes });
  ctx.clip();
  // Масса внутри это те же контуры, но заваленные друг на друга: рисунок сгущается к краю,
  // а середина остаётся пустой, как у всего, что снято через оптику.
  ctx.globalAlpha = MEMBRANE_MASS_ALPHA;
  ctx.strokeStyle = ink;
  for (let step = 0; step < MEMBRANE_MASS_STEPS; step += 1) {
    const t = step / MEMBRANE_MASS_STEPS;
    ctx.lineWidth = between(random, 1, 3);
    traceLobe(ctx, noise, {
      radius: radius * (0.15 + t * 0.8),
      scale: scale * between(random, 0.7, 1.6),
      wobble: MEMBRANE_WOBBLE * between(random, 0.4, 1.8),
      lobes,
    });
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.strokeStyle = ink;
  ctx.lineWidth = between(random, 2, 4);
  traceLobe(ctx, noise, { radius: radius * 0.92, scale, wobble: MEMBRANE_WOBBLE, lobes });
  ctx.stroke();
  ctx.restore();
}

/** Контур: слои поля шума, снятые как горизонтали на карте. */
function paintContour(ctx, size, random, ink) {
  const noise = createNoise2D(random);
  const scale = between(random, NOISE_SCALE[0], NOISE_SCALE[1]);
  const rings = Math.round(between(random, CONTOUR_RINGS[0], CONTOUR_RINGS[1]));

  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.strokeStyle = ink;
  for (let ring = 1; ring <= rings; ring += 1) {
    ctx.lineWidth = ring % 4 === 0 ? 2.5 : 1;
    traceLobe(ctx, noise, {
      radius: (size / 2) * (ring / rings) * 0.94,
      scale,
      wobble: CONTOUR_WOBBLE * (ring / rings),
      lobes: 1,
    });
    ctx.stroke();
  }
  ctx.restore();
}

/** Осколки: обломок без границы и без слоёв, куски одной поверхности врозь. */
function paintShards(ctx, size, random, ink) {
  const count = Math.round(between(random, SHARD_COUNT[0], SHARD_COUNT[1]));
  ctx.save();
  ctx.fillStyle = ink;
  for (let shard = 0; shard < count; shard += 1) {
    const span = size * between(random, SHARD_SPAN[0], SHARD_SPAN[1]);
    const x = between(random, 0, size - span);
    const y = between(random, 0, size - span);
    ctx.globalAlpha = between(random, 0.25, 1);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + span, y + between(random, -span, span) * 0.3);
    ctx.lineTo(x + span * between(random, 0.3, 0.9), y + span);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

const PAINTERS = { membrane: paintMembrane, contour: paintContour, shards: paintShards };

/** Предмет со стороной `size` на прозрачном холсте. Вид выбирает сид, а не вызывающий. */
export function createFieldObject({ size, random, ink }) {
  const kind = KINDS[Math.floor(random() * KINDS.length) % KINDS.length];
  const layer = createLayer(size, size);
  PAINTERS[kind](layer.ctx, size, random, ink);
  return { canvas: layer.canvas, kind };
}
