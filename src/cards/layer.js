/**
 * Отдельный холст под один слой карточки.
 *
 * Трафаретная перемычка, разъезд каналов и блочный сдвиг вырезают и двигают уже готовые
 * пиксели, а не рисуют поверх: делать это прямо на карточке нельзя, дыра прошла бы насквозь
 * до фона. Поэтому такие приёмы собирают слой отдельно и кладут его целиком.
 */

export function createLayer(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return { canvas, ctx: canvas.getContext('2d') };
}
