import typeface from './fonts/grenze-gotisch.typeface.json';

/**
 * Готика афиши UNDERSTAV в двух видах.
 *
 * Объёмный заголовок читает `typeface.json` (другого формата TextGeometry не понимает),
 * а трафареты плит рисуются на canvas и требуют настоящий файл шрифта в браузере. Форматы
 * разные, шрифт один, и знание о нём лежит здесь, а не расползается по модулям.
 */

const FAMILY = 'Understav Gothic';
const FILE = 'assets/fonts/grenze-gotisch.ttf';

export const GOTHIC_TYPEFACE = typeface;

export const GOTHIC_FACE = { weight: 'normal', stack: `'${FAMILY}', serif` };

let loading = null;

/** Шрифт приезжает файлом: в системе зрителя готики нет, а трафарет молча вышел бы гротеском. */
export function loadGothic() {
  loading ??= new FontFace(FAMILY, `url(${FILE})`)
    .load()
    .then((face) => {
      document.fonts.add(face);
    });
  return loading;
}
