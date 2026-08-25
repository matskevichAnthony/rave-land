/**
 * Краска карточки: цвет берётся из палитры сцены, а прозрачность считается здесь.
 *
 * Canvas принимает полупрозрачный цвет только строкой `rgba(...)`, и без общего пересчёта
 * каждый модуль завёл бы свои хексы рядом с палитрой. Отсюда одна функция на весь набор.
 */

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
