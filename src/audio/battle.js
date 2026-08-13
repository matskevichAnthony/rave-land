import { createAudioBus } from './bus.js';
import { createSamples } from './samples.js';
import { fireVoice, gunCharacter } from './gun.js';
import { actionClack, casingDrop, dryClick, reloadSequence } from './mech.js';
import { impactVoice } from './impact.js';

/**
 * Единственная дверь в боевой звук: снаружи известны только ствол, точка в мире и повод.
 *
 * Каждый звук это отдельный голос на шине. Выстрел и лязг железа сидят в одном голосе,
 * потому что звучат из одной точки, а гильза в своём: она падает под ноги и позже.
 *
 * Звучат записи San Andreas, а синтез остаётся вторым эшелоном и работает, пока файлы
 * декодируются, и дальше на всём, чего в архиве не нашлось. Перезарядка как раз такая:
 * лязга магазина в GENRL нет, он лежит в другом архиве игры.
 */

const SHOT_SEND = 0.55;
const MECH_SEND = 0.12;
const IMPACT_SEND = 0.25;
// Гильза летит из окна выброса на землю: полтора метра свободного падения.
const CASING_FALL = 0.45;
const CASING_DROP_HEIGHT = 1.3;

export function createBattleAudio({ camera, context = null }) {
  const bus = createAudioBus({ camera, context });
  const samples = createSamples(bus.ctx);

  function play(position, send, render) {
    if (!bus.ready()) return;
    const voice = bus.voice(position, send);
    voice.release(render(bus.ctx, voice.input, bus.now()));
  }

  /** Запись, если она уже доехала, иначе синтез: тишины на выстрел быть не должно. */
  function playRecorded(position, send, family, synthesized) {
    play(position, send, samples.voice(family) ?? synthesized);
  }

  return {
    shot(weapon, position) {
      const gun = gunCharacter(weapon);
      playRecorded(position, SHOT_SEND, samples.familyOf(weapon), (ctx, out, t0) => Math.max(
        fireVoice(ctx, out, t0, gun),
        actionClack(ctx, out, t0, gun),
      ));
      const ground = { x: position.x, y: position.y - CASING_DROP_HEIGHT, z: position.z };
      play(ground, MECH_SEND, (ctx, out, t0) => {
        const drop = t0 + gun.cycle + CASING_FALL;
        return (samples.voice('casing') ?? casingDrop)(ctx, out, drop, gun);
      });
    },

    dryFire(position) {
      playRecorded(position, MECH_SEND, 'dry', dryClick);
    },

    reload(weapon, position) {
      const gun = gunCharacter(weapon);
      play(position, MECH_SEND, (ctx, out, t0) => reloadSequence(ctx, out, t0, gun));
    },

    impact(position, kind) {
      playRecorded(position, IMPACT_SEND, kind, (ctx, out, t0) => impactVoice(ctx, out, t0, kind));
    },
  };
}
