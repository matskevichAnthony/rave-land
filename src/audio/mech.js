import { click, ping } from './dsp.js';

/**
 * Железо оружия: ход затвора, боёк по пустому патроннику, перезарядка, гильза.
 *
 * Времена не выдуманы, они берутся из портрета ствола: цикл клипа выстрела говорит,
 * сколько ходит затвор, ёмкость магазина говорит, сколько возиться с перезарядкой, а вес
 * заряда опускает тон металла у крупного калибра.
 */

const CLACK_HZ = 2400;
const CLACK_Q = 1.1;
const CLACK_DECAY = 0.022;
const SLIDE_BACK = { at: 0.35, level: 0.3 };
const SLIDE_FORWARD = { at: 0.62, level: 0.5 };
const PUMP_BACK = { at: 0.4, level: 0.5 };
const PUMP_FORWARD = { at: 0.6, level: 0.75 };
// Помпа лязгает крупным железом: тон ниже, спад длиннее, полоса шире.
const PUMP_PITCH = 0.55;
const PUMP_Q = 0.8;
const PUMP_DECAY = 0.05;

const DRY_HZ = 3000;
const DRY_DECAY = 0.012;
const DRY_LEVEL = 1.1;
const DRY_SPRING_HZ = 1800;
const DRY_SPRING_LEVEL = 0.16;

const RELOAD_BASE = 0.9;
const RELOAD_PER_ROUND = 0.02;
const MAG_OUT_AT = 0.14;
const MAG_IN_AT = 0.55;
const MAG_HZ = 700;
const SHELL_INSERT_HZ = 900;
const SHELL_INSERT_AT = 0.25;
const SHELL_INSERT_LEVEL = 0.5;
const MAG_RELEASE_LEVEL = 0.45;
const MAG_OUT_LEVEL = 0.4;
const MAG_IN_LEVEL = 0.65;

const CASING_HZ = 5200;
const CASING_DETUNE = 0.12;
const CASING_BOUNCES = [
  { at: 0, level: 1 },
  { at: 0.085, level: 0.5 },
  { at: 0.15, level: 0.28 },
  { at: 0.195, level: 0.16 },
];
const CASING_LEVEL = 0.2;
const CASING_DECAY = 0.055;
// Гильза не только звенит, но и цокает по земле кромкой.
const CASING_TICK_LEVEL = 0.16;
const CASING_TICK_PITCH = 1.4;
// Дробовая гильза пластиковая: не звенит, а стучит.
const HULL_HZ = 700;
const HULL_LEVEL = 0.22;

function clack(ctx, out, t0, gun, step) {
  const pitch = gun.pumpAction ? PUMP_PITCH : 1;
  return click(ctx, out, t0 + gun.cycle * step.at, {
    freq: (CLACK_HZ * pitch) / gun.weight,
    q: gun.pumpAction ? PUMP_Q : CLACK_Q,
    decay: gun.pumpAction ? PUMP_DECAY : CLACK_DECAY,
    level: step.level,
  });
}

/** Затвор ушёл назад и вернулся: два удара металла внутри цикла клипа выстрела. */
export function actionClack(ctx, out, t0, gun) {
  const steps = gun.pumpAction ? [PUMP_BACK, PUMP_FORWARD] : [SLIDE_BACK, SLIDE_FORWARD];
  return Math.max(...steps.map((step) => clack(ctx, out, t0, gun, step)));
}

/** Боёк по пустому патроннику: сухой щелчок и короткий отзвук пружины. */
export function dryClick(ctx, out, t0) {
  return Math.max(
    click(ctx, out, t0, { freq: DRY_HZ, q: 1.2, decay: DRY_DECAY, level: DRY_LEVEL }),
    ping(ctx, out, t0, { freq: DRY_SPRING_HZ, decay: 0.04, level: DRY_SPRING_LEVEL }),
  );
}

/** Магазин долой, новый на место, затвор вперёд. У помпы вместо этого патрон в трубку. */
export function reloadSequence(ctx, out, t0, gun) {
  if (gun.pumpAction) {
    const insert = click(ctx, out, t0, {
      freq: SHELL_INSERT_HZ, q: 1.6, decay: 0.04, level: SHELL_INSERT_LEVEL,
    });
    return Math.max(insert, actionClack(ctx, out, t0 + SHELL_INSERT_AT, gun));
  }
  const span = RELOAD_BASE + gun.magazine * RELOAD_PER_ROUND;
  const release = click(ctx, out, t0, {
    freq: CLACK_HZ, q: 1.4, decay: 0.012, level: MAG_RELEASE_LEVEL,
  });
  const dropped = click(ctx, out, t0 + span * MAG_OUT_AT, {
    freq: MAG_HZ / gun.weight, q: 0.9, decay: 0.06, level: MAG_OUT_LEVEL,
  });
  const home = click(ctx, out, t0 + span * MAG_IN_AT, {
    freq: (MAG_HZ * 1.6) / gun.weight, q: 1.1, decay: 0.05, level: MAG_IN_LEVEL,
  });
  return Math.max(release, dropped, home, clack(ctx, out, t0 + span, gun, SLIDE_FORWARD));
}

/** Гильза на землю: несколько отскоков, каждый тише и короче прошлого. */
export function casingDrop(ctx, out, t0, gun) {
  let end = t0;
  for (const bounce of CASING_BOUNCES) {
    const at = t0 + bounce.at;
    if (gun.pumpAction) {
      end = Math.max(end, click(ctx, out, at, {
        freq: HULL_HZ, q: 1.2, decay: 0.03, level: HULL_LEVEL * bounce.level,
      }));
      continue;
    }
    const detune = 1 + (Math.random() - 0.5) * CASING_DETUNE;
    const freq = (CASING_HZ / Math.sqrt(gun.weight)) * detune;
    end = Math.max(
      end,
      ping(ctx, out, at, { freq, decay: CASING_DECAY, level: CASING_LEVEL * bounce.level }),
      click(ctx, out, at, {
        freq: freq * CASING_TICK_PITCH,
        q: 2,
        decay: 0.01,
        level: CASING_TICK_LEVEL * bounce.level,
      }),
    );
  }
  return end;
}
