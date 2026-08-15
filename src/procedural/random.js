/** Отрезок между двумя числами. Генератор приходит параметром: своего здесь нет. */
export function between(random, min, max) {
  return min + random() * (max - min);
}
