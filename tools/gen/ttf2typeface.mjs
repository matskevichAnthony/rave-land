import { readFile, writeFile } from 'node:fs/promises';

import { TTFLoader } from 'three/addons/loaders/TTFLoader.js';

/**
 * TTF → typeface.json для TextGeometry.
 *
 * Объёмный текст в three читает только typeface-формат, а шрифты приходят в TTF. Конвертор
 * тот же, что в браузере (`TTFLoader.parse`), поэтому результат совпадает с рантаймовым, но
 * лежит в дереве готовым и не тянет ни загрузку шрифта, ни парсер в сцену.
 *
 * Использование:
 *   node tools/gen/ttf2typeface.mjs <шрифт.ttf> <выход.typeface.json>
 */

const [source, target] = process.argv.slice(2);

if (!source || !target) {
  console.error('использование: node tools/gen/ttf2typeface.mjs <шрифт.ttf> <выход.typeface.json>');
  process.exit(1);
}

const ttf = await readFile(source);
const typeface = new TTFLoader().parse(ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength));

await writeFile(target, JSON.stringify(typeface));
console.log(`${typeface.familyName}: ${Object.keys(typeface.glyphs).length} глифов → ${target}`);
