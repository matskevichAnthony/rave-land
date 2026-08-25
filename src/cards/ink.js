/**
 * Краска карточки: цвет берётся из палитры сцены, а прозрачность считается здесь.
 *
 * Canvas принимает полупрозрачный цвет только строкой `rgba(...)`, и без общего пересчёта
 * каждый модуль завёл бы свои хексы рядом с палитрой. Отсюда одна функция на весь набор.
 */

import { PALETTE } from '../understav/palette.js';

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const CHANNELS = 3;

function channels(hex) {
  const clean = hex.replace('#', '');
  return Array.from({ length: CHANNELS }, (_, index) => Number.parseInt(
    clean.slice(index * HEX_PAIR, index * HEX_PAIR + HEX_PAIR),
    HEX_RADIX,
  ));
}

export function rgba(hex, alpha) {
  return `rgba(${channels(hex).join(', ')}, ${alpha})`;
}

/** Смесь двух цветов: доля `t` от нуля (первый) до единицы (второй). */
export function mix(hexA, hexB, t) {
  const a = channels(hexA);
  const b = channels(hexB);
  const blend = a.map((channel, index) => Math.round(channel + (b[index] - channel) * t));
  return `#${blend.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

export const DEFAULT_HOT = PALETTE.ember;
export const DEFAULT_COLD = PALETTE.moon;

/**
 * Краски карточки из двух глобальных цветов пульта.
 *
 * Жар держит всю тёплую семью (акцент, свет, ореол, ржавчину, кровь), холод держит
 * холодную (луну и трип). Нейтральные тона остаются палитрой сцены: они несут бетон и
 * кость, и их кручение разваливало бы карточку на чужие материалы. Так два ползунка
 * перекрашивают всю серию, не ломая её устройство.
 */
export function makeInks({ hot = DEFAULT_HOT, cold = DEFAULT_COLD } = {}) {
  return {
    ...PALETTE,
    ember: hot,
    flame: mix(hot, '#ffffff', 0.72),
    emberHalo: mix(hot, '#ffffff', 0.42),
    rust: mix(hot, '#000000', 0.6),
    blood: mix(hot, '#000000', 0.16),
    moon: cold,
    trip: mix(cold, '#000000', 0.25),
  };
}

/** Вертикальный градиент: остановки идут списком `[доля, цвет, прозрачность]`. */
export function verticalFade(ctx, top, bottom, stops) {
  const fade = ctx.createLinearGradient(0, top, 0, bottom);
  for (const [offset, hex, alpha] of stops) fade.addColorStop(offset, rgba(hex, alpha));
  return fade;
}

/** Пятно света: круглый градиент от цвета к прозрачности того же цвета. */
export function halo(ctx, { x, y, radius, hex, alpha }) {
  const spot = ctx.createRadialGradient(x, y, 0, x, y, radius);
  spot.addColorStop(0, rgba(hex, alpha));
  spot.addColorStop(1, rgba(hex, 0));
  return spot;
}
