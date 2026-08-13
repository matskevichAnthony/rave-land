import { envelope, noiseBurst, sweep } from './dsp.js';

/**
 * Выстрел: характер ствола выводится из weapon.dat, а не назначается на слух.
 *
 * Четыре ствола это не четыре набора констант, а одна формула на разных числах. Урон
 * говорит про массу заряда, то есть про низ и длину хлопка. Дальность говорит про скорость
 * пули, то есть про резкость сверхзвукового щелчка. Отрезок клипа выстрела говорит, сколько
 * ходит железо, из него берут время лязга и вылета гильзы.
 */

const REFERENCE_DAMAGE = 25;
const BLAST_HZ = 210;
const BLAST_BY_WEIGHT = 0.6;
const CRACK_HZ = 1400;
const CRACK_PER_METRE = 34;
const CRACK_FULL_RANGE = 70;
// Дробь летит кучей и медленно, сверхзвукового щелчка у неё почти нет.
const PELLET_CRACK = 0.25;
const MIN_CYCLE = 0.08;

const GAS_PEAK = 5.5;
const GAS_DECAY = 0.05;
const GAS_OPEN = 9;
const GAS_Q = 3;
const PELLET_Q = 0.6;
const THUMP_PEAK = 0.45;
const THUMP_MAX = 0.78;
const THUMP_SWEEP = 0.08;
const THUMP_FROM = 1.7;
const THUMP_TO = 0.55;
const THUMP_DECAY = 0.09;
const CRACK_PEAK = 1.1;
const CRACK_DECAY = 0.014;
const CRACK_Q = 1.2;
const TAIL_PEAK = 0.5;
const TAIL_DECAY = 0.14;
const TAIL_BY_WEIGHT = 0.12;
const TAIL_FROM = 2400;
const TAIL_TO = 260;

/** Портрет ствола в терминах синтеза: всё, что дальше, читает только его. */
export function gunCharacter(weapon) {
  // Помпа узнаётся по данным: магазин на один патрон и нет флага перезарядки, значит
  // патрон досылают руками, а не меняют магазин.
  const pumpAction = weapon.magazine === 1 && !weapon.flags.reload;
  // В weapon.dat у дробовика записан урон одной дробины, а из ствола их вылетает горсть:
  // вес заряда считается по всему выстрелу, поэтому число дробин берётся из самого ствола.
  const charge = weapon.damage * weapon.bullets;
  const weight = Math.sqrt(charge / REFERENCE_DAMAGE);
  return {
    pumpAction,
    weight,
    magazine: weapon.magazine,
    cycle: Math.max(weapon.fireTo - weapon.fireFrom, MIN_CYCLE),
    blastHz: BLAST_HZ / weight ** BLAST_BY_WEIGHT,
    crackHz: CRACK_HZ + weapon.range * CRACK_PER_METRE,
    crack: pumpAction ? PELLET_CRACK : Math.min(weapon.range / CRACK_FULL_RANGE, 1),
  };
}

/** Газы: шум под лоу-пассом, который падает вслед за давлением в стволе. */
function gasBlast(ctx, out, t0, gun) {
  const decay = GAS_DECAY * (0.6 + gun.weight);
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  low.Q.value = gun.pumpAction ? PELLET_Q : GAS_Q;
  sweep(low.frequency, t0, gun.blastHz * GAS_OPEN, gun.blastHz, decay);
  const level = ctx.createGain();
  const end = envelope(level.gain, t0, { peak: GAS_PEAK, attack: 0.0015, decay });
  noiseBurst(ctx, t0, end).connect(low).connect(level).connect(out);
  return end;
}

/** Бух: тон, скользящий вниз. Тем ниже и тяжелее, чем крупнее заряд. */
function thump(ctx, out, t0, gun) {
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  sweep(osc.frequency, t0, gun.blastHz * THUMP_FROM, gun.blastHz * THUMP_TO, THUMP_SWEEP);
  const level = ctx.createGain();
  const end = envelope(level.gain, t0, {
    peak: Math.min(THUMP_PEAK * gun.weight, THUMP_MAX),
    attack: 0.002,
    decay: THUMP_DECAY * gun.weight,
  });
  osc.connect(level).connect(out);
  osc.start(t0);
  osc.stop(end);
  return end;
}

/** Щелчок пули: узкая полоса на самом верху, злая у винтовки и почти немая у дроби. */
function crack(ctx, out, t0, gun) {
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = gun.crackHz;
  band.Q.value = CRACK_Q;
  const level = ctx.createGain();
  const end = envelope(level.gain, t0, {
    peak: CRACK_PEAK * gun.crack,
    attack: 0.0006,
    decay: CRACK_DECAY,
  });
  noiseBurst(ctx, t0, end).connect(band).connect(level).connect(out);
  return end;
}

/** Ближний хвост: поле возвращает выстрел глухим шорохом, дальний доигрывает эхо шины. */
function tail(ctx, out, t0, gun) {
  const decay = TAIL_DECAY + TAIL_BY_WEIGHT * gun.weight;
  const low = ctx.createBiquadFilter();
  low.type = 'lowpass';
  sweep(low.frequency, t0, TAIL_FROM, TAIL_TO, decay);
  const level = ctx.createGain();
  const end = envelope(level.gain, t0, { peak: TAIL_PEAK, attack: 0.006, decay });
  noiseBurst(ctx, t0, end).connect(low).connect(level).connect(out);
  return end;
}

export function fireVoice(ctx, out, t0, gun) {
  return Math.max(
    gasBlast(ctx, out, t0, gun),
    thump(ctx, out, t0, gun),
    crack(ctx, out, t0, gun),
    tail(ctx, out, t0, gun),
  );
}
