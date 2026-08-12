import { createReadStream, existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

import { GENERATED, assetDir, createAsset, incomingImages, readAssets, saveAsset, takeIncoming } from './library.js';
import { FILES, PRESETS, STEPS } from './pipeline.js';
import { busy, cancel, run } from './runner.js';

/** Маршруты генератора внутри дев-сервера: питоновские инструменты процессами.
 *
 * Отдельного сервера нет намеренно. Torch в браузере не живёт, а второй демон
 * это второй запуск, второй порт и второй способ забыть его погасить, тогда как
 * `npm run dev` уже поднят и страница всё равно ходит только к нему.
 *
 * Прогресс отдаётся построчным JSON (NDJSON) в незакрытом ответе: шаги идут
 * минутами, и молчащий запрос неотличим от зависшего. SSE тут не нужен, запросы
 * POST, а поток односторонний.
 */

const PROMPT_LIMIT = 500;
const TRIANGLES_RANGE = [50, 200000];
const SIZE_RANGE = [0.05, 50];
const CONTENT_TYPES = {
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8',
};

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function inRange(value, [low, high], name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < low || number > high) {
    throw new Error(`${name}: жду число от ${low} до ${high}, пришло «${value}»`);
  }
  return number;
}

/** Всё, что приходит из браузера, проверяется здесь: дальше идут только числа и свои имена. */
function readParams(payload) {
  const prompt = String(payload.prompt ?? '').trim();
  if (prompt.length > PROMPT_LIMIT) throw new Error(`Промпт длиннее ${PROMPT_LIMIT} символов`);
  return {
    prompt,
    preset: PRESETS.includes(payload.preset) ? payload.preset : PRESETS[0],
    triangles: payload.triangles ? inRange(payload.triangles, TRIANGLES_RANGE, 'Бюджет') : null,
    size: payload.size ? inRange(payload.size, SIZE_RANGE, 'Габарит') : null,
  };
}

function openStream(res) {
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });
  return (event) => res.write(`${JSON.stringify(event)}\n`);
}

async function runStep(name, payload, res) {
  const step = STEPS[name];
  const params = readParams(payload);

  const problem = step.ready();
  if (problem) return json(res, 503, { error: problem });
  if (busy()) return json(res, 409, { error: 'Прогон уже идёт: машина тянет только один' });

  const id = payload.asset ?? createAsset(params).id;
  const dir = assetDir(id);
  if (step.needs && !existsSync(join(dir, FILES[step.needs]))) {
    return json(res, 400, { error: `Сначала нужен шаг «${STEPS[step.needs].title}»` });
  }

  const emit = openStream(res);
  emit({ type: 'start', step: name, title: step.title, asset: id });
  // Ушедшая страница это брошенный прогон: держать 2.2 ГБ ради никого нельзя. Флаг
  // обязателен: закрытие ответа приходит и после нормального конца, а к тому времени
  // страница успевает попросить следующий шаг маршрута, и отмена убила бы уже его.
  let running = true;
  res.on('close', () => running && cancel());
  try {
    const spec = step.command(dir, params);
    emit({ type: 'log', at: 0, text: `${spec.command} ${spec.args.join(' ')}` });
    const { seconds, peakMegabytes } = await run({ ...spec, noise: step.noise }, emit);
    if (!existsSync(join(dir, FILES[step.produces]))) {
      throw new Error(`Инструмент отработал, но ${FILES[step.produces]} не появился`);
    }
    emit({ type: 'done', seconds, peakMegabytes, asset: saveAsset({ id, preset: params.preset }) });
  } catch (error) {
    emit({ type: 'error', message: error.message });
  }
  running = false;
  res.end();
}

/** Свежие файлы прогона отдаёт сам генератор.
 *
 * Дев-сервер знает состав `public` по списку, собранному при старте и обновляемому
 * наблюдателем, а каталог прогонов из-под наблюдения выведен: иначе каждая
 * записанная картинка перезагружала бы страницу посреди прогона. Появившийся файл
 * в тот список не попадает, поэтому его отдаём сами.
 */
function sendFile(name, res) {
  const path = resolve(GENERATED, name);
  if (!path.startsWith(GENERATED + sep) || !existsSync(path)) {
    return json(res, 404, { error: `Нет файла ${name}` });
  }
  res.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  createReadStream(path).pipe(res);
}

const ROUTES = {
  'GET /assets': (_payload, res) => json(res, 200, { assets: readAssets(), busy: busy() }),
  'GET /incoming': (_payload, res) => json(res, 200, { images: incomingImages() }),
  'POST /cancel': (_payload, res) => json(res, 200, { cancelled: cancel() }),
  'POST /import': (payload, res) => json(res, 200, {
    asset: takeIncoming({
      name: String(payload.name),
      id: payload.asset,
      preset: readParams(payload).preset,
    }),
  }),
};

const FILE_ROUTE = '/file/';

async function api(req, res, next) {
  const path = (req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  if (req.method === 'GET' && path.startsWith(FILE_ROUTE)) {
    return sendFile(decodeURIComponent(path.slice(FILE_ROUTE.length)), res);
  }

  const route = ROUTES[`${req.method} ${path}`];
  const step = req.method === 'POST' && path.startsWith('/run/') ? path.slice('/run/'.length) : '';
  if (!route && !STEPS[step]) return next();

  try {
    const payload = await readBody(req);
    if (route) route(payload, res);
    else await runStep(step, payload, res);
  } catch (error) {
    if (res.headersSent) return res.end();
    json(res, 400, { error: error.message });
  }
}

export function generatorApi() {
  return {
    name: 'rave-land-generator-api',
    configureServer(server) {
      server.middlewares.use('/api/gen', api);
    },
  };
}
