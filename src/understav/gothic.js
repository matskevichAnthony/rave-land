/**
 * Готика афиши UNDERSTAV в двух видах и на двух алфавитах.
 *
 * Потребителя два, и форматы им нужны разные. Трафареты плит рисуются на canvas и требуют
 * настоящий файл шрифта в браузере; объёмная надпись строится `TextGeometry`, а та понимает
 * только шрифт, разобранный в кривые. Шрифт при этом один, и знание о нём лежит здесь.
 *
 * Разбор в кривые едет файлом из `public`, а не импортом: он весит больше полумегабайта, и
 * собранный в бандл попадал бы даже в те страницы, которым от этого модуля нужно одно имя
 * семейства. Объёмная надпись у афиши одна, и полмегабайта она спрашивает сама за себя.
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

// В кривые разобрана только латинская готика: объём на афише набирает название события, а
// оно латиницей. Понадобится кириллический объём, тут появится вторая запись, а не ветка
// в вызывающем модуле.
const TYPEFACE_URL = 'assets/fonts/grenze-gotisch.typeface.json';

const CYRILLIC = /[Ѐ-ӿ]/;

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

let typeface = null;

/** Готика, разобранная в кривые: `TextGeometry` другого формата не понимает. */
export async function loadGothicTypeface() {
  typeface ??= fetch(TYPEFACE_URL).then((response) => {
    if (!response.ok) throw new Error(`готика в кривых не отдалась: ${response.status}`);
    return response.json();
  });
  return typeface;
}
