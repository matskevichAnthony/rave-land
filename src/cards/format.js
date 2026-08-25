/**
 * Форматы холста афиши и рамка макета.
 *
 * Размер приходит сюда числом один раз, а направления рисуют в долях рамки, поэтому одна
 * и та же вёрстка встаёт и в ленту, и в квадрат под текстуру. Квадрат нужен не из любви к
 * симметрии: афиши потом клеят на стены коридора сцены, а туда уходит картинка со стороной
 * в степень двойки и без прозрачности по краям.
 */

export const FORMATS = {
  feed: { label: 'Лента 1080×1350', width: 1080, height: 1350 },
  wall: { label: 'Стена 1024×1024', width: 1024, height: 1024 },
};

export const DEFAULT_FORMAT = 'feed';

// Единица макета: сотая доля короткой стороны. Кегли и отступы меряются ей, а не пикселями,
// иначе при смене формата вёрстка расходится с самой собой.
const UNIT_DIVISOR = 100;
const MARGIN_UNITS = 7;

export function createFrame({ width, height }) {
  const unit = Math.min(width, height) / UNIT_DIVISOR;
  const margin = unit * MARGIN_UNITS;
  return {
    width,
    height,
    unit,
    margin,
    left: margin,
    right: width - margin,
    top: margin,
    bottom: height - margin,
    innerWidth: width - margin * 2,
    innerHeight: height - margin * 2,
  };
}
