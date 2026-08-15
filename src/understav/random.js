/**
 * Сид сцены: восемь знаков hex дают один и тот же кадр навсегда.
 *
 * Удачный дубль ловится случайно, и без воспроизводимого сида его не повторить, поэтому
 * ни один модуль сцены не зовёт `Math.random`, а берёт поток отсюда.
 */

const HEX_DIGITS = 8;

export function seedToInt(seed) {
  const clean = String(seed).replace(/[^0-9a-f]/gi, '').slice(0, HEX_DIGITS) || '0';
  return Number.parseInt(clean, 16) >>> 0;
}

export function randomSeed() {
  const bytes = crypto.getRandomValues(new Uint8Array(HEX_DIGITS / 2));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Мулберри32: короткий, быстрый и одинаковый во всех браузерах. */
export function createRandom(seed) {
  let state = seedToInt(seed) + 0x6d2b79f5;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (min, max) => min + next() * (max - min);
  next.int = (min, max) => Math.floor(next.range(min, max + 1));
  next.pick = (items) => items[Math.floor(next() * items.length)];
  next.sign = () => (next() < 0.5 ? -1 : 1);
  return next;
}
