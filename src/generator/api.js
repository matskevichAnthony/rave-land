const BASE = '/api/gen';

/** Разговор с дев-сервером: короткие ответы JSON, долгие прогоны построчным потоком. */

async function unpack(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `сервер ответил ${response.status}`);
  return payload;
}

export async function ask(path) {
  return unpack(await fetch(BASE + path));
}

export async function send(path, body) {
  return unpack(await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

/** Своя картинка уходит байтами: base64 в JSON раздул бы её на треть на ровном месте. */
export async function upload(blob, query) {
  return unpack(await fetch(`${BASE}/upload?${new URLSearchParams(query)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: blob,
  }));
}

/** Прогон шага: события приходят по мере работы инструмента, а не пачкой в конце. */
export async function runStep(step, params, onEvent) {
  const response = await fetch(`${BASE}/run/${step}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error
    ?? `сервер ответил ${response.status}`);

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let tail = '';
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const lines = (tail + value).split('\n');
    tail = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      onEvent(event);
      if (event.type === 'error') throw new Error(event.message);
      if (event.type === 'done') result = event;
    }
  }
  if (!result) throw new Error('Прогон оборвался без ответа: смотри терминал дев-сервера');
  return result;
}

export const cancelRun = () => send('/cancel', {});
