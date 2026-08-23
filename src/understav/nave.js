/**
 * Координатное соглашение нефа UNDERSTAV.
 *
 * Свет, архитектура, типографика и камера меряют один и тот же зал, поэтому метры
 * записаны здесь один раз, а не переписаны числами в четырёх модулях.
 *
 * Центр алтаря стоит в начале координат, фронт сцены смотрит в +Z.
 */

export const NAVE = {
  frontZ: 10,
  endZ: -22,
  halfWidth: 13,
  vaultHeight: 22,
  colonnadeHalfWidth: 9,
  altarRadius: 6,
  altarHeight: 0.9,
};

// Роза поднята над коробкой типографики: на прежней высоте самое крупное слово афиши стояло
// ровно в самом контрастном пятне кадра, и спицы трейсери шли между букв.
export const ROSE = { y: 17.5, radius: 6 };

/**
 * Коридор перед нефом: по нему камера подлетает к афише издалека.
 *
 * Зал он не трогает, начинается за его порталом и живёт своими метрами, поэтому ни один
 * предмет прежней сцены от него не сдвинулся.
 */
export const CORRIDOR = {
  farZ: 118,
  span: 4.4,
  arch: { radius: 7, lift: 7.2, thickness: 0.7 },
  pier: { x: 6.6, width: 1.2, depth: 1.1 },
};

/** Коробка под лайнап: внутри неё не стоит ни одна деталь зала. */
export const TYPE_BOX = { x: 0, y: 5.5, z: 0, width: 12, height: 9, depth: 2 };

/** Точка, с которой снимают афишу: от неё считается, что в кадре ляжет поверх текста. */
export const POSTER_EYE = { y: 5.5, z: 26 };

/**
 * Ложится ли точка зала на текст в кадре афиши.
 *
 * Проверять надо конус зрения, а не объём коробки: цепь, честно висящая в десяти метрах
 * за текстом, на экране всё равно перечёркивает имена, потому что стоит на том же луче.
 */
export function crossesTypeOnScreen(x, z, margin = 0) {
  const depth = POSTER_EYE.z - z;
  if (depth <= 0) return false;
  const spread = depth / (POSTER_EYE.z - TYPE_BOX.z);
  return Math.abs(x - TYPE_BOX.x) < (TYPE_BOX.width / 2 + margin) * spread;
}

/** Ближайшее к оси место сбоку от текста: туда уводят то, что иначе перечеркнёт имена. */
export function besideType(x, z, margin = 0) {
  const spread = (POSTER_EYE.z - z) / (POSTER_EYE.z - TYPE_BOX.z);
  const clear = (TYPE_BOX.width / 2 + margin) * spread;
  return Math.sign(x || 1) * Math.min(Math.max(Math.abs(x), clear), NAVE.colonnadeHalfWidth);
}

/**
 * Кольцо бочек с углями.
 *
 * Два места закреплены намеренно: на них смотрят тёплые точечные источники из `stage.js`,
 * и сид не должен уводить бочку из-под своего огня.
 */
export const EMBER_RING = { radius: 7.6, anchors: [-0.75, 2.4] };

/** Холодный ключ бьёт сквозь розу: обе точки читают и свет, и луч из розы. */
export const KEY_LIGHT = { from: [0, 26, -40], to: [0, 0.9, 0] };

export const BOUNDS = { radius: 18, height: 24 };
