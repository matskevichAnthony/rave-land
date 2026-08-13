import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { FILES, ROOT } from './pipeline.js';

/** Каталог сгенерированного и опись к нему.
 *
 * Это рабочая опись самого генератора: промпт, пресет, время и отчёт шага
 * лоуполи. Общей описью проекта она не притворяется и чужих ассетов не знает.
 * Единый список всего, что в проекте есть моделями, собирает по диску
 * `tools/inventory`, и прогоны попадают туда сами, вместе с остальными.
 *
 * Состав записи собирается с диска, а не копится в памяти: что лежит в папке
 * прогона, то и записано в описи.
 */

export const GENERATED = resolve(ROOT, 'public/assets/generated');
export const INCOMING = resolve(ROOT, '_other/incoming');

const MANIFEST = join(GENERATED, 'manifest.json');
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const IMAGE_SUFFIX = /\.(png|jpg|jpeg)$/i;
const TITLE_LIMIT = 70;

export function assetDir(id) {
  if (!ID.test(id)) throw new Error(`Недопустимое имя прогона: ${id}`);
  return join(GENERATED, id);
}

/** Прогон удаляется удалением его папки: запись без папки в опись не попадает. */
export function readAssets() {
  if (!existsSync(MANIFEST)) return [];
  return JSON.parse(readFileSync(MANIFEST, 'utf8')).assets
    .filter((asset) => existsSync(join(GENERATED, asset.id)));
}

function readStats(dir) {
  const path = join(dir, FILES.stats);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

// Промпты пишутся по-русски, а имя прогона это имя папки на диске и ссылка на файлы.
const CYRILLIC = [...'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'];
const LATIN = ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o',
  'p', 'r', 's', 't', 'u', 'f', 'h', 'c', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya'];
const TRANSLIT = new Map(CYRILLIC.map((letter, index) => [letter, LATIN[index]]));

/** Свободное имя прогона по промпту: по нему потом видно, что это было. */
function newId(prompt) {
  const latin = [...prompt.toLowerCase()].map((letter) => TRANSLIT.get(letter) ?? letter).join('');
  const words = latin.replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
  const base = words.filter(Boolean).slice(0, 3).join('-') || 'asset';
  let id = base;
  for (let suffix = 2; existsSync(join(GENERATED, id)); suffix += 1) id = `${base}-${suffix}`;
  return id;
}

export function createAsset({ prompt, preset }) {
  const id = newId(prompt);
  mkdirSync(assetDir(id), { recursive: true });
  return saveAsset({ id, prompt, preset });
}

export function saveAsset({ id, prompt, preset }) {
  const dir = assetDir(id);
  const assets = readAssets();
  const previous = assets.find((asset) => asset.id === id);
  const now = new Date().toISOString();
  const record = {
    id,
    title: (prompt ?? previous?.prompt ?? id).slice(0, TITLE_LIMIT),
    prompt: prompt ?? previous?.prompt ?? '',
    preset: preset ?? previous?.preset ?? 'prop',
    created: previous?.created ?? now,
    updated: now,
    files: Object.fromEntries(
      Object.entries(FILES)
        .filter(([, file]) => existsSync(join(dir, file)))
        .map(([step, file]) => [step, `${id}/${file}`]),
    ),
    stats: readStats(dir),
  };
  const rest = assets.filter((asset) => asset.id !== id);
  mkdirSync(GENERATED, { recursive: true });
  writeFileSync(
    MANIFEST,
    `${JSON.stringify({ assets: [record, ...rest] }, null, 2)}\n`,
    'utf8',
  );
  return record;
}

/** Готовые картинки из _other/incoming: маршрут можно начать с середины. */
export function incomingImages() {
  if (!existsSync(INCOMING)) return [];
  return readdirSync(INCOMING).filter((name) => IMAGE_SUFFIX.test(name)).sort();
}

export function takeIncoming({ name, preset }) {
  const file = basename(name);
  if (!incomingImages().includes(file)) throw new Error(`Нет такой картинки: ${file}`);
  const { id } = createAsset({ prompt: file.replace(IMAGE_SUFFIX, ''), preset });
  copyFileSync(join(INCOMING, file), join(assetDir(id), FILES.image));
  return saveAsset({ id, preset });
}
