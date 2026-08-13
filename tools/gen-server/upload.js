import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assetDir, createAsset, saveAsset } from './library.js';
import { FILES } from './pipeline.js';

/** Своя картинка со страницы: тот же вход маршрута, что и у сгенерированной.
 *
 * Тело запроса приходит сырыми байтами, а не JSON: base64 раздувает картинку на
 * треть и заставляет держать её в памяти дважды.
 *
 * Принесённая картинка всегда открывает новый прогон. Подмена картинки в старом
 * оставила бы рядом меш и проп, посчитанные с другой, и опись врала бы о том,
 * что в папке лежит.
 */

const SIZE_LIMIT_BYTES = 8 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const NAME_LIMIT = 60;

async function readBytes(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > SIZE_LIMIT_BYTES) {
      throw new Error(`Картинка больше ${SIZE_LIMIT_BYTES / 1024 / 1024} МБ`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function acceptImage(req, { name, preset }) {
  const bytes = await readBytes(req);
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('Жду PNG: страница переводит принесённую картинку в него сама');
  }
  const prompt = String(name ?? '').replace(/\.[a-z0-9]+$/i, '').slice(0, NAME_LIMIT);
  const { id } = createAsset({ prompt, preset });
  writeFileSync(join(assetDir(id), FILES.image), bytes);
  return saveAsset({ id, preset });
}
