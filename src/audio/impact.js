import { click, envelope, noiseBurst, ping, sweep } from './dsp.js';

/**
 * Куда пришла пуля. Мясо глушит удар и звенеть ему нечем, бетон отвечает щелчком и
 * осыпается крошкой ещё четверть секунды.
 */

const BODY_THUMP_HZ = 95;
const BODY_SLAP_HZ = 780;
const BODY_TOP_HZ = 420;
const BODY_DECAY = 0.1;
const BODY_FLESH_LEVEL = 1.2;
const BODY_BASS_LEVEL = 0.5;
const BODY_SLAP_LEVEL = 0.45;

const GROUND_CRACK_HZ = 2200;
const GROUND_THUMP_HZ = 150;
const GROUND_DECAY = 0.045;
const DEBRIS_COUNT = 4;
const DEBRIS_HZ = 3400;
const DEBRIS_SPREAD = 0.28;
const DEBRIS_DELAY = 0.04;
const DEBRIS_LEVEL = 0.13;
const GROUND_CRACK_LEVEL = 1;
const GROUND_BASS_LEVEL = 0.4;

/** Глухой шлепок: удар вязнет в теле, наверху почти ничего не остаётся. */
function bodyImpact(ctx, out, t0) {
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  sweep(low.frequency, t0, BODY_TOP_HZ * 3, BODY_TOP_HZ, BODY_DECAY);
  const level = ctx.createGain();
  const end = envelope(level.gain, t0, {
    peak: BODY_FLESH_LEVEL, attack: 0.002, decay: BODY_DECAY,
  });
  noiseBurst(ctx, t0, end).connect(low).connect(level).connect(out);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  sweep(osc.frequency, t0, BODY_THUMP_HZ * 1.8, BODY_THUMP_HZ, 0.06);
  const bass = ctx.createGain();
  const bassEnd = envelope(bass.gain, t0, { peak: BODY_BASS_LEVEL, attack: 0.003, decay: 0.13 });
  osc.connect(bass).connect(out);
  osc.start(t0);
  osc.stop(bassEnd);

  const slap = click(ctx, out, t0, {
    freq: BODY_SLAP_HZ, q: 0.9, decay: 0.02, level: BODY_SLAP_LEVEL,
  });
  return Math.max(end, bassEnd, slap);
}

/** Бетон: сухой щелчок, короткий удар в низ и разлетающаяся крошка. */
function groundImpact(ctx, out, t0) {
  const crack = click(ctx, out, t0, {
    freq: GROUND_CRACK_HZ, q: 0.8, decay: GROUND_DECAY, level: GROUND_CRACK_LEVEL,
  });

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  sweep(osc.frequency, t0, GROUND_THUMP_HZ * 2, GROUND_THUMP_HZ, 0.05);
  const bass = ctx.createGain();
  const bassEnd = envelope(bass.gain, t0, { peak: GROUND_BASS_LEVEL, attack: 0.002, decay: 0.07 });
  osc.connect(bass).connect(out);
  osc.start(t0);
  osc.stop(bassEnd);

  let end = Math.max(crack, bassEnd);
  for (let i = 0; i < DEBRIS_COUNT; i += 1) {
    const at = t0 + DEBRIS_DELAY + Math.random() * DEBRIS_SPREAD;
    end = Math.max(end, ping(ctx, out, at, {
      freq: DEBRIS_HZ * (0.6 + Math.random()),
      decay: 0.02,
      level: DEBRIS_LEVEL,
    }));
  }
  return end;
}

const IMPACTS = { body: bodyImpact, ground: groundImpact };

export function impactVoice(ctx, out, t0, kind) {
  return (IMPACTS[kind] ?? IMPACTS.ground)(ctx, out, t0);
}

export const IMPACT_KINDS = Object.keys(IMPACTS);
