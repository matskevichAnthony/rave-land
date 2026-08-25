import typeface from './fonts/grenze-gotisch.typeface.json';

/**
 * Готика афиши UNDERSTAV в двух видах и на двух алфавитах.
 *
 * Объёмный заголовок читает `typeface.json` (другого формата TextGeometry не понимает),
 * а трафареты плит рисуются на canvas и требуют настоящий файл шрифта в браузере. Форматы
 * разные, шрифт один, и знание о нём лежит здесь, а не расползается по модулям.
 *
 * Латиница и кириллица идут разными файлами не по прихоти: в Grenze Gotisch кириллицы нет
 * вовсе, и русская строка вышла бы из него системным гротеском, то есть готики на афише не
 * осталось бы ровно там, где её просили. Ruslan Display это ближайшая по духу вязь с полной
 * кириллицей, поэтому строку ведёт алфавит самой строки, а не настройка снаружи.
 */

const FACES = {
  latin: { family: 'Understav Gothic', file: 'assets/fonts/grenze-gotisch.ttf' },
  cyrillic: { family: 'Understav Slavic', file: 'assets/fonts/ruslan-display.ttf' },
};

const CYRILLIC = /[Ѐ-ӿ]/;

export const GOTHIC_TYPEFACE = typeface;

/** Начертание под строку: кириллица уходит в вязь, всё остальное в готику. */
export function gothicFaceFor(text) {
  const face = CYRILLIC.test(text) ? FACES.cyrillic : FACES.latin;
  return { weight: 'normal', stack: `'${face.family}', serif` };
}

let loading = null;

/** Шрифт приезжает файлом: в системе зрителя готики нет, а трафарет молча вышел бы гротеском. */
export function loadGothic() {
  loading ??= Promise.all(Object.values(FACES).map((face) => new FontFace(face.family, `url(${face.file})`)
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
    })));
  return loading;
}
