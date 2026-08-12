import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/** Запуск инструмента процессом: построчный поток в страницу, пик памяти, отмена.
 *
 * Прогон строго один за раз. Машина четырёхъядерная и с 7 ГБ, один TripoSR держит
 * 2.2 ГБ, поэтому второй параллельный прогон уводит систему в swap, а не ускоряет.
 */

const RSS_INTERVAL_MS = 500;
const KILL_GRACE_MS = 3000;

let current = null;

export const busy = () => current !== null;

export function cancel() {
  if (!current) return false;
  const { child } = current;
  current.cancelled = true;
  child.kill('SIGTERM');
  // Упрямого добиваем, но только пока это всё ещё он: следующий прогон убивать нельзя.
  setTimeout(() => current?.child === child && child.kill('SIGKILL'), KILL_GRACE_MS);
  return true;
}

async function rssMegabytes(pid) {
  const status = await readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
  const found = status.match(/VmRSS:\s+(\d+) kB/);
  return found ? Number(found[1]) / 1024 : 0;
}

/** Собирает поток в целые строки: процессы пишут кусками, а не сообщениями.
 *
 * Полоски прогресса (tqdm у диффузии и загрузки весов) перерисовывают одну строку
 * возвратом каретки, поэтому от такой строки берётся последнее состояние.
 */
function lineSplitter(emit) {
  let tail = '';
  return (chunk) => {
    const parts = (tail + chunk).split('\n');
    tail = parts.pop();
    for (const line of parts) emit(line.split('\r').pop());
  };
}

export function run({ command, args, cwd, env, noise }, emit) {
  if (current) throw new Error('Прогон уже идёт, дождись конца или отмени его');

  const started = Date.now();
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
  current = { child, cancelled: false };

  const since = () => Math.round((Date.now() - started) / 100) / 10;
  let last = '';
  const log = (text) => {
    if (!text.trim() || (noise && noise.test(text))) return;
    last = text;
    emit({ type: 'log', at: since(), text });
  };
  const split = lineSplitter(log);
  child.stdout.on('data', (chunk) => split(String(chunk)));
  child.stderr.on('data', (chunk) => split(String(chunk)));

  let peak = 0;
  const watcher = setInterval(async () => {
    peak = Math.max(peak, await rssMegabytes(child.pid));
  }, RSS_INTERVAL_MS);

  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      clearInterval(watcher);
      current = null;
      reject(new Error(`${command} не запустился: ${error.message}`));
    });
    child.on('close', (code) => {
      clearInterval(watcher);
      const cancelled = current?.cancelled;
      current = null;
      if (cancelled) return reject(new Error('Прогон отменён'));
      // Причину инструмент обычно объясняет сам, и последняя его строка это и есть объяснение.
      if (code !== 0) return reject(new Error(`Инструмент вышел с кодом ${code}: ${last}`));
      resolve({ seconds: since(), peakMegabytes: Math.round(peak) });
    });
  });
}
