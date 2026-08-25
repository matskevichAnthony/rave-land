/** Список направлений афиши: пульт и отрисовка берут его отсюда, а не держат свои копии. */

import datamosh from './datamosh.js';
import field from './field.js';
import iron from './iron.js';
import stencil from './stencil.js';

export const DIRECTIONS = [stencil, iron, datamosh, field];

export const DEFAULT_DIRECTION = DIRECTIONS[0].id;

export function directionById(id) {
  return DIRECTIONS.find((direction) => direction.id === id) ?? DIRECTIONS[0];
}
