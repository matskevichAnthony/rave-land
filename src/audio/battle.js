import { createAudioBus } from './bus.js';
import { fireVoice, gunCharacter } from './gun.js';
import { actionClack, casingDrop, dryClick, reloadSequence } from './mech.js';
import { impactVoice } from './impact.js';

/**
 * Единственная дверь в боевой звук: снаружи известны только ствол, точка в мире и повод.
 *
 * Каждый звук это отдельный голос на шине. Выстрел и лязг железа сидят в одном голосе,
 * потому что звучат из одной точки, а гильза в своём: она падает под ноги и позже.
 */

const SHOT_SEND = 0.55;
const MECH_SEND = 0.12;
const IMPACT_SEND = 0.25;
// Гильза летит из окна выброса на землю: полтора метра свободного падения.
const CASING_FALL = 0.45;
const CASING_DROP_HEIGHT = 1.3;

export function createBattleAudio({ camera, context = null }) {
  const bus = createAudioBus({ camera, context });

  function play(position, send, render) {
    if (!bus.ready()) return;
    const voice = bus.voice(position, send);
    voice.release(render(bus.ctx, voice.input, bus.now()));
  }

  return {
    shot(weapon, position) {
      const gun = gunCharacter(weapon);
      play(position, SHOT_SEND, (ctx, out, t0) => Math.max(
        fireVoice(ctx, out, t0, gun),
        actionClack(ctx, out, t0, gun),
      ));
      const ground = { x: position.x, y: position.y - CASING_DROP_HEIGHT, z: position.z };
      play(ground, MECH_SEND, (ctx, out, t0) =>
        casingDrop(ctx, out, t0 + gun.cycle + CASING_FALL, gun));
    },

    dryFire(position) {
      play(position, MECH_SEND, dryClick);
    },

    reload(weapon, position) {
      const gun = gunCharacter(weapon);
      play(position, MECH_SEND, (ctx, out, t0) => reloadSequence(ctx, out, t0, gun));
    },

    impact(position, kind) {
      play(position, IMPACT_SEND, (ctx, out, t0) => impactVoice(ctx, out, t0, kind));
    },
  };
}
