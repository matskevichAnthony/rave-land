/**
 * Кирпичи синтеза: шум, огибающая, свип частоты и два коротких удара.
 *
 * Ни одной ссылки на глобальный контекст: любая функция пишет в переданный, поэтому
 * одинаково работает и в живом AudioContext игры, и в оффлайновом на замерах.
 */

const NOISE_SECONDS = 1;
// Экспонента в ноль не приходит никогда, поэтому у неё есть пол, с которого огибающая
// линейно уходит в тишину: обрыв ненулевого уровня слышен щелчком.
const ENVELOPE_FLOOR = 0.0008;
const RELEASE_SECONDS = 0.004;

const noiseBuffers = new WeakMap();

function noiseBuffer(ctx) {
  const cached = noiseBuffers.get(ctx);
  if (cached) return cached;
  const buffer = ctx.createBuffer(1, Math.round(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  noiseBuffers.set(ctx, buffer);
  return buffer;
}

/** Кусок белого шума со случайного места общего буфера: два выстрела подряд не близнецы. */
export function noiseBurst(ctx, t0, end) {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx);
  source.loop = true;
  source.start(t0, Math.random() * NOISE_SECONDS);
  source.stop(end);
  return source;
}

/** Ударная огибающая: почти мгновенный подъём, экспоненциальный спад, ноль в конце. */
export function envelope(param, t0, { peak, attack, hold = 0, decay }) {
  param.setValueAtTime(0, t0);
  param.linearRampToValueAtTime(peak, t0 + attack);
  const from = t0 + attack + hold;
  if (hold > 0) param.setValueAtTime(peak, from);
  param.exponentialRampToValueAtTime(peak * ENVELOPE_FLOOR, from + decay);
  const end = from + decay + RELEASE_SECONDS;
  param.linearRampToValueAtTime(0, end);
  return end;
}

export function sweep(param, t0, from, to, seconds) {
  param.setValueAtTime(from, t0);
  param.exponentialRampToValueAtTime(to, t0 + seconds);
}

/** Щелчок: полоса шума под ударной огибающей. Из него собрано всё железо оружия. */
export function click(ctx, out, t0, { freq, q = 1.4, decay, level }) {
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = q;
  const amp = ctx.createGain();
  const end = envelope(amp.gain, t0, { peak: level, attack: 0.0008, decay });
  noiseBurst(ctx, t0, end).connect(band).connect(amp).connect(out);
  return end;
}

/** Звон: тон с быстрым спадом, голос металла (гильза, пружина, осколок бетона). */
export function ping(ctx, out, t0, { freq, decay, level }) {
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const amp = ctx.createGain();
  const end = envelope(amp.gain, t0, { peak: level, attack: 0.001, decay });
  osc.connect(amp).connect(out);
  osc.start(t0);
  osc.stop(end);
  return end;
}
